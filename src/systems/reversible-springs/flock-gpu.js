import {validateGraph,checksum,momentum} from './springs-cpu.mjs';
import {stepFlock} from './flock-cpu.mjs?v=boids1';
import {SpringCoefficientTimeline,evolveWithCoefficients} from './springs-timeline.mjs?v=boids1';

export class ReversibleFlockGPU {
  static async create({
    device,
    fixture,
    fetchImpl=globalThis.fetch,
    shaderUrl=new URL('./flock.wgsl',import.meta.url),
  }={}){
    if(!device||!fixture)throw Error('WebGPU device and spring fixture required');
    const response=await fetchImpl(shaderUrl,{cache:'no-store'});
    if(!response.ok)throw Error('Spring shader HTTP '+response.status);
    const solver=new ReversibleFlockGPU(device,fixture,await response.text());
    await solver.initialize();
    return solver;
  }
  constructor(device,{graph,state,hidden},shaderCode){
    validateGraph(graph);
    if(!(state instanceof Int32Array)||state.length!==graph.count*8)
      throw Error('Expected 8 i32 words per spring particle');
    if(!(hidden instanceof Int32Array)||hidden.length!==graph.count*4)
      throw Error('Flock needs four hidden words per particle');
    if(graph.boundaryExtent!==undefined&&(!Number.isSafeInteger(graph.boundaryExtent)||graph.boundaryExtent<1||graph.boundaryExtent>1000000))throw Error('Invalid reflective boundary extent');
    this.initialHidden=hidden.slice();
    this.device=device;this.graph=graph;this.initial=state.slice();this.shaderCode=shaderCode;
    this.current=0;this.tick=0;this.buffers=[];
    this.timeline=new SpringCoefficientTimeline(graph);
    this.eventBindGroups=new WeakMap();
  }
  async initialize(){
    const d=this.device,U=globalThis.GPUBufferUsage;
    if(!U)throw Error('GPUBufferUsage is unavailable');
    const module=d.createShaderModule({label:'Lapinet reversible springs',code:this.shaderCode});
    const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
    if(errors.length)throw Error('Spring WGSL: '+errors.map(e=>e.lineNum+':'+e.message).join('; '));
    this.pipeline=await d.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'springStage'}});
    const make=(label,size,usage)=>{
      const b=d.createBuffer({label,size:Math.max(16,size),usage});
      this.buffers.push(b);return b;
    };
    this.states=[0,1].map(i=>make('spring particle state '+i,this.initial.byteLength,U.STORAGE|U.COPY_SRC|U.COPY_DST));
    this.hiddenStates=[0,1].map(i=>make('flock hidden velocity '+i,this.initialHidden.byteLength,
      U.STORAGE|U.COPY_SRC|U.COPY_DST));
    d.queue.writeBuffer(this.hiddenStates[0],0,this.initialHidden);
    const csr=this.graph;
    this.offsets=make('spring CSR offsets',csr.offsets.byteLength,U.STORAGE|U.COPY_DST);
    this.neighbors=make('spring CSR neighbor IDs',csr.indices.byteLength,U.STORAGE|U.COPY_DST);
    this.rests=make('spring directed rest edges',csr.rests.byteLength,U.STORAGE|U.COPY_DST);
    d.queue.writeBuffer(this.states[0],0,this.initial);
    d.queue.writeBuffer(this.offsets,0,csr.offsets);
    d.queue.writeBuffer(this.neighbors,0,csr.indices);
    d.queue.writeBuffer(this.rests,0,csr.rests);
    this.bindEvent(this.timeline.events[0]);

  }
  bindEvent(event){
    const d=this.device,U=globalThis.GPUBufferUsage,c=this.graph,v=event.values;
    const params=Array.from({length:10},(_,operation)=>{
      const buffer=d.createBuffer({
        label:'Spring coefficients tick '+event.tick+' op '+operation,
        size:64,usage:U.UNIFORM|U.COPY_DST,
      });
      this.buffers.push(buffer);
      d.queue.writeBuffer(buffer,0,new Int32Array([
        c.count,operation,c.mode==='straight'?2:(c.mode==='dynamic'||c.mode==='flock')?1:0,c.precision,
        v.cutoff*v.cutoff,c.restLength*c.restLength,
        v.stiffness,v.restScale256,v.alignment,v.coupling,c.boundaryExtent??0,c.goalX??0,
        v.cohesion,v.separation,v.steering,Math.trunc(v.cutoff*2/3)
      ]));
      return buffer;
    });
    const groups=params.map(param=>[0,1].map(src=>{
      const all=[
        this.states[src],this.states[1-src],
        this.offsets,this.neighbors,this.rests,param,
        this.hiddenStates[src],this.hiddenStates[1-src],
      ];
      return d.createBindGroup({
        layout:this.pipeline.getBindGroupLayout(0),
        entries:all.map((buffer,binding)=>({binding,resource:{buffer}})),
      });
    }));
    this.eventBindGroups.set(event,groups);
    return groups;
  }
  coefficientsAt(tick=this.tick){return this.timeline.at(tick)}
  setCoefficients(patch){
    const event=this.timeline.change(this.tick,patch);
    if(event)this.bindEvent(event);
    Object.assign(this.graph,this.timeline.at(this.tick));
    return {...this.timeline.at(this.tick)};
  }
  get stateBuffer(){return this.states[this.current]}
  get hiddenBuffer(){return this.hiddenStates[this.current]}
  encodeStage(encoder,operation,event){
    const pass=encoder.beginComputePass({label:'flock op '+operation});
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0,this.eventBindGroups.get(event)[operation][this.current]);
    pass.dispatchWorkgroups(Math.ceil(this.graph.count/128));
    pass.end();
    this.current^=1;
  }
  step(ticks=1,{reverse=false}={}){
    if(!Number.isInteger(ticks)||ticks<1||ticks>256)
      throw Error('Spring batch must be 1..256 ticks');
    if(reverse&&ticks>this.tick)throw Error('Cannot reverse before spring tick zero');
    const encoder=this.device.createCommandEncoder({
      label:'Spring '+(reverse?'reverse':'forward')+' '+ticks
    });
    let remaining=ticks;
    while(remaining>0){
      const event=this.timeline.eventAt(reverse?this.tick-1:this.tick);
      const boundary=reverse?event.tick:this.timeline.nextTick(this.tick);
      const span=Math.min(remaining,reverse?this.tick-boundary:boundary-this.tick);
      if(!(span>0))throw Error('Invalid spring timeline span');
      for(let i=0;span>i;i++){
        if(reverse){
          for(const op of [2,3,9,6,7])this.encodeStage(encoder,op,event);
        }else{
          for(const op of [4,5,8,0,1])this.encodeStage(encoder,op,event);
        }
      }
      this.tick+=reverse?-span:span;
      remaining-=span;
    }
    this.device.queue.submit([encoder.finish()]);
    Object.assign(this.graph,this.timeline.at(this.tick));
  }
  reset(){
    const values=this.timeline.at(this.tick);
    this.device.queue.writeBuffer(this.states[0],0,this.initial);
    this.device.queue.writeBuffer(this.hiddenStates[0],0,this.initialHidden);
    this.current=0;this.tick=0;
    this.timeline=new SpringCoefficientTimeline({...this.graph,...values});
    this.bindEvent(this.timeline.events[0]);
    Object.assign(this.graph,this.timeline.at(0));
  }
  async read(){
    const U=globalThis.GPUBufferUsage;
    const size=this.initial.byteLength;
    const temp=this.device.createBuffer({label:'Spring diagnostic readback',size,usage:U.COPY_DST|U.MAP_READ});
    try{
      const encoder=this.device.createCommandEncoder();
      encoder.copyBufferToBuffer(this.stateBuffer,0,temp,0,size);
      this.device.queue.submit([encoder.finish()]);
      await temp.mapAsync(globalThis.GPUMapMode.READ);
      const result=new Int32Array(temp.getMappedRange().slice(0));
      temp.unmap();return result;
    }finally{temp.destroy()}
  }
  async readHidden(){
    const U=globalThis.GPUBufferUsage;
    const size=this.initialHidden.byteLength;
    const temp=this.device.createBuffer({
      label:'Flock hidden readback',size,usage:U.COPY_DST|U.MAP_READ
    });
    try{
      const enc=this.device.createCommandEncoder();
      enc.copyBufferToBuffer(this.hiddenBuffer,0,temp,0,size);
      this.device.queue.submit([enc.finish()]);
      await temp.mapAsync(globalThis.GPUMapMode.READ);
      const result=new Int32Array(temp.getMappedRange().slice(0));
      temp.unmap();return result;
    }finally{temp.destroy()}
  }
  async certify({roundtrip=32}={}){
    const before=await this.read(),beforeHidden=await this.readHidden(),start=this.tick;
    let cpu={state:before,hidden:beforeHidden};
    for(let i=0;i<roundtrip;i++)
      cpu=stepFlock(cpu.state,cpu.hidden,
        {...this.graph,...this.timeline.at(start+i)});
    this.step(roundtrip);
    const forward=await this.read(),hForward=await this.readHidden();
    const cpuMismatches=forward.reduce((n,x,i)=>n+(x!==cpu.state[i]),0)+
      hForward.reduce((n,x,i)=>n+(x!==cpu.hidden[i]),0);
    this.step(roundtrip,{reverse:true});
    const after=await this.read(),hAfter=await this.readHidden();
    const inverseMismatches=before.reduce((n,x,i)=>n+(x!==after[i]),0)+
      beforeHidden.reduce((n,x,i)=>n+(x!==hAfter[i]),0);
    return {passed:cpuMismatches===0&&inverseMismatches===0,
      tick:start,cpuMismatches,inverseMismatches,
      checksum:checksum(before),momentum:momentum(before),
      particles:this.graph.count,edges:this.graph.indices.length};
  }
  destroy(){for(const b of this.buffers)b.destroy?.();this.buffers=[]}
}
