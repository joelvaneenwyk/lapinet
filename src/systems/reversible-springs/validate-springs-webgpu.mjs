import {createLatticeFixture,evolve,momentum,checksum} from './springs-cpu.mjs';
const adapter=await navigator.gpu.requestAdapter();
if(!adapter)throw Error('No WebGPU adapter');
const dev=await adapter.requestDevice();
const module=dev.createShaderModule({code:await Deno.readTextFile(new URL('./springs.wgsl',import.meta.url))});
const errors=(await module.getCompilationInfo()).messages.filter(x=>x.type==='error');
if(errors.length)throw Error(errors.map(x=>x.message).join('\n'));
const pipeline=await dev.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'springStage'}});
const U=GPUBufferUsage;
const make=(size,usage,label)=>dev.createBuffer({size:Math.max(size,16),usage,label});
const verify=async({nx,ny,nz,ticks,mode='bonded',precision=16,spacing=96,perturbation=14})=>{
 const {graph,state:initial}=createLatticeFixture({nx,ny,nz,spacing,stiffness:18,perturbation,mode,precision,cutoff:Math.round(spacing*1.45),restLength:spacing});
 const recordBytes=initial.byteLength;
 const states=[0,1].map(i=>make(recordBytes,U.STORAGE|U.COPY_DST|U.COPY_SRC,'state'+i));
 const starts=make(graph.offsets.byteLength,U.STORAGE|U.COPY_DST,'starts');
 const neighbors=make(graph.indices.byteLength,U.STORAGE|U.COPY_DST,'neighbors');
 const rests=make(graph.rests.byteLength,U.STORAGE|U.COPY_DST,'rests');
 const params=[0,1,2,3].map(i=>make(32,U.UNIFORM|U.COPY_DST,'operation'+i));
 dev.queue.writeBuffer(states[0],0,initial);
 dev.queue.writeBuffer(starts,0,graph.offsets);
 dev.queue.writeBuffer(neighbors,0,graph.indices);
 dev.queue.writeBuffer(rests,0,graph.rests);
 params.forEach((b,i)=>dev.queue.writeBuffer(b,0,new Int32Array([
   graph.count,i,graph.mode==='dynamic'?1:0,graph.precision,
   graph.cutoff**2,graph.restLength**2,graph.stiffness,graph.restScale256??256
  ])));
 const groups=params.map(b=>[0,1].map(src=>dev.createBindGroup({
  layout:pipeline.getBindGroupLayout(0),
  entries:[states[src],states[1-src],starts,neighbors,rests,b].map((buffer,binding)=>({binding,resource:{buffer}}))
 })));
 let active=0;
 const stage=(encoder,op)=>{
  const pass=encoder.beginComputePass();
  pass.setPipeline(pipeline);pass.setBindGroup(0,groups[op][active]);
  pass.dispatchWorkgroups(Math.ceil(graph.count/128));pass.end();
  active=1-active;
 };
 const submit=(count,reverse)=>{
  const encoder=dev.createCommandEncoder();
  for(let t=0;t<count;t++)
   if(reverse){stage(encoder,2);stage(encoder,3);}
   else{stage(encoder,0);stage(encoder,1);}
  dev.queue.submit([encoder.finish()]);
 };
 const read=async()=>{
  const staging=make(recordBytes,U.COPY_DST|U.MAP_READ,'staging');
  const enc=dev.createCommandEncoder();
  enc.copyBufferToBuffer(states[active],0,staging,0,recordBytes);
  dev.queue.submit([enc.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const data=new Int32Array(staging.getMappedRange().slice(0));
  staging.unmap();staging.destroy();return data;
 };
 const started=performance.now();
 for(let i=0;i<ticks;i+=64)submit(Math.min(ticks-i,64),false);
 await dev.queue.onSubmittedWorkDone();
 const forward=await read(),cpuForward=evolve(initial,graph,ticks);
 const forwardMismatches=forward.reduce((n,v,i)=>n+(v!==cpuForward[i]),0);
 const firstDuration=performance.now()-started;
 for(let i=0;i<ticks;i+=64)submit(Math.min(ticks-i,64),true);
 await dev.queue.onSubmittedWorkDone();
 const restored=await read(),reverseMismatches=restored.reduce((n,v,i)=>n+(v!==initial[i]),0);
 const result={particles:graph.count,directedEdges:graph.indices.length,ticks,mode,precision,spacing,forwardMismatches,reverseMismatches,
  momentumBefore:momentum(initial),momentumAfter:momentum(forward),
  initialHash:checksum(initial),forwardHash:checksum(forward),
  gpuForwardMs:Math.round(firstDuration*100)/100};
 states.forEach(b=>b.destroy());starts.destroy();neighbors.destroy();rests.destroy();params.forEach(b=>b.destroy());
 if(forwardMismatches||reverseMismatches||result.momentumAfter.some(v=>v!==0))throw Error('Hardware certificate failed: '+JSON.stringify(result));
 return result;
};
const tests=[
 {nx:6,ny:6,nz:3,ticks:256},
 {nx:8,ny:8,nz:4,ticks:96},
 {nx:12,ny:12,nz:6,ticks:32,precision:32,spacing:44,perturbation:6},
 {nx:16,ny:16,nz:4,ticks:24},
 {nx:16,ny:16,nz:16,ticks:16},
 {nx:6,ny:6,nz:3,ticks:48,mode:'dynamic'},
 {nx:8,ny:8,nz:4,ticks:24,mode:'dynamic',precision:32},
 {nx:8,ny:8,nz:4,ticks:12,mode:'dynamic',precision:64},
 {nx:24,ny:24,nz:12,ticks:8,precision:64,spacing:21,perturbation:3},
 // Public demo's highest-density *cubic* 24^3 (not the old 24x24x12 slab).
 {nx:24,ny:24,nz:24,ticks:8,precision:64,spacing:21,perturbation:3}
];
const results=[];
for(const test of tests){const r=await verify(test);results.push(r);console.log(JSON.stringify(r));}
dev.destroy();console.log('PASS '+results.length+'/'+tests.length+' GPU/CPU spring certificates');
