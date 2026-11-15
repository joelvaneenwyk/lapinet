import {createLatticeFixture,springPairs,dynamicPairs,step} from './springs-cpu.mjs';
import {evolveWithCoefficients} from './springs-timeline.mjs';
import {ReversibleSpringsGPU} from './springs-gpu.js';
const adapter=await navigator.gpu.requestAdapter();
const device=await adapter.requestDevice();
const shader=await Deno.readTextFile(new URL('./springs-render.wgsl',import.meta.url));
const module=device.createShaderModule({code:shader});
const errors=(await module.getCompilationInfo()).messages.filter(x=>x.type==='error');
if(errors.length)throw Error(errors.map(x=>x.lineNum+': '+x.message).join('\n'));
const format='rgba8unorm',U=GPUBufferUsage,T=GPUTextureUsage;
if(Deno.args.includes('--box-only')){
 const box=await device.createRenderPipelineAsync({
  layout:'auto',vertex:{module,entryPoint:'boxVertex'},
  fragment:{module,entryPoint:'edgeFragment',targets:[{
   format,
   blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},
    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}
  }]},primitive:{topology:'line-list'}
 });
 const view=device.createBuffer({size:80,usage:U.UNIFORM|U.COPY_DST});
 device.queue.writeBuffer(view,0,new Float32Array([256,256,0.00012,2,-0.55,0.4,0.4,-1]));
 device.queue.writeBuffer(view,64,new Float32Array([5000,0,0,0]));
 const bind=device.createBindGroup({layout:box.getBindGroupLayout(0),entries:[
  {binding:1,resource:{buffer:view}}
 ]});
 const target=device.createTexture({size:[256,256,1],format,
  usage:T.RENDER_ATTACHMENT|T.COPY_SRC});
 const staging=device.createBuffer({size:256*256*4,usage:U.COPY_DST|U.MAP_READ});
 device.pushErrorScope('validation');
 const enc=device.createCommandEncoder();
 const pass=enc.beginRenderPass({colorAttachments:[{
  view:target.createView(),clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'
 }]});
 pass.setPipeline(box);pass.setBindGroup(0,bind);pass.draw(24);pass.end();
 enc.copyTextureToBuffer({texture:target},{buffer:staging,bytesPerRow:256*4,
  rowsPerImage:256},{width:256,height:256,depthOrArrayLayers:1});
 device.queue.submit([enc.finish()]);
 await staging.mapAsync(GPUMapMode.READ);
 const pixels=new Uint8Array(staging.getMappedRange());
 let lit=0;
 for(let i=0;i<pixels.length;i+=4)if(pixels[i]>20||pixels[i+1]>20)lit++;
 staging.unmap();
 const validationError=await device.popErrorScope();
 if(validationError||lit<20)throw Error('Box GPU validation failed '+(validationError?.message||'blank '+lit));
 console.log('PASS reflective enclosure GPU wireframe '+lit+' lit pixels');
 staging.destroy();target.destroy();view.destroy();device.destroy();
 Deno.exit(0);
}
const particles=await device.createRenderPipelineAsync({layout:'auto',
 vertex:{module,entryPoint:'vertexMain'},
 fragment:{module,entryPoint:'fragmentMain',targets:[{format}]},
 primitive:{topology:'triangle-strip'}});
const edges=await device.createRenderPipelineAsync({layout:'auto',
 vertex:{module,entryPoint:'edgeVertex'},
 fragment:{module,entryPoint:'edgeFragment',targets:[{format,
 blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},
 alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},
 primitive:{topology:'line-list'}});
async function run(mode,nx,ny,nz,precision=32){
 const fixture=createLatticeFixture({nx,ny,nz,mode,precision,
  spacing:Math.round(480/(nx-1)),cutoff:Math.round(480/(nx-1)*1.45),
  restLength:Math.round(480/(nx-1)),perturbation:8});
 const solver=await ReversibleSpringsGPU.create({device,fixture,fetchImpl:async()=>({
  ok:true,text:async()=>await Deno.readTextFile(new URL('./springs.wgsl',import.meta.url))
 })});
 solver.step(6);
 const localCert=await solver.certify({roundtrip:8});
 if(!localCert.passed)throw Error('Interactive GPU solver certificate failed '+JSON.stringify(localCert));

 const before=await solver.read(),initialTick=solver.tick;
 solver.setCoefficients({stiffness:29});
 const unchanged=await solver.read();
 if(unchanged.some((x,i)=>x!==before[i])||solver.tick!==initialTick)
  throw Error('Live coefficients mutated particle state or tick');
 solver.step(5);
 solver.setCoefficients({
  cutoff:Math.round(fixture.graph.spacing*1.8),
  restScale256:311
 });
 solver.step(7);
 solver.setCoefficients({stiffness:9,restScale256:384});
 solver.step(4);
 const advanced=await solver.read();
 const expected=evolveWithCoefficients(before,fixture.graph,solver.timeline,initialTick,16,step);
 const cpuErrors=advanced.reduce((n,x,i)=>n+(x!==expected[i]),0);
 solver.step(16,{reverse:true});
 const restored=await solver.read();
 const inverseErrors=restored.reduce((n,x,i)=>n+(x!==before[i]),0);
 solver.step(16);
 const replay=await solver.read();
 const replayErrors=replay.reduce((n,x,i)=>n+(x!==advanced[i]),0);
 if(cpuErrors||inverseErrors||replayErrors)
  throw Error('Live coefficient replay failed '+JSON.stringify({cpuErrors,inverseErrors,replayErrors}));
 const liveCert=await solver.certify({roundtrip:8});
 if(!liveCert.passed)throw Error('Live certificate failed '+JSON.stringify(liveCert));
 console.log(JSON.stringify({mode,liveCoefficients:true,
  firstTick:initialTick,lastTick:solver.tick,
  changes:solver.timeline.events.length-1,
  cpuErrors,inverseErrors,replayErrors}));

 const link=mode==='dynamic'?dynamicPairs(fixture.graph.count):springPairs(fixture.graph);
 const edgeBuffer=device.createBuffer({size:Math.max(16,link.byteLength),usage:U.STORAGE|U.COPY_DST});
 device.queue.writeBuffer(edgeBuffer,0,link);
 const viewBuffer=device.createBuffer({size:80,usage:U.UNIFORM|U.COPY_DST});
 const scale=1.75/(nx*fixture.graph.spacing*fixture.graph.precision);
 const width=512,height=512;
 device.queue.writeBuffer(viewBuffer,0,new Float32Array([width,height,scale,3.4,-0.55,0.4,
  0.65,mode==='dynamic'?(fixture.graph.cutoff*fixture.graph.precision)**2:-1]));
 device.queue.writeBuffer(viewBuffer,32,new Int32Array([
  fixture.graph.precision,fixture.graph.cutoff**2,mode==='dynamic'?1:0,0]));
 const target=device.createTexture({size:[width,height,1],format,usage:T.RENDER_ATTACHMENT|T.COPY_SRC});
 const read=device.createBuffer({size:width*height*4,usage:U.COPY_DST|U.MAP_READ});
 const edgeBind=device.createBindGroup({layout:edges.getBindGroupLayout(0),
  entries:[solver.stateBuffer,viewBuffer,edgeBuffer].map((buffer,binding)=>({binding,resource:{buffer}}))});
 const particleBind=device.createBindGroup({layout:particles.getBindGroupLayout(0),
  entries:[solver.stateBuffer,viewBuffer].map((buffer,binding)=>({binding,resource:{buffer}}))});
 device.pushErrorScope('validation');
 const encoder=device.createCommandEncoder();
 const pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),
  clearValue:{r:0.018,g:0.025,b:0.04,a:1},loadOp:'clear',storeOp:'store'}]});
 pass.setPipeline(edges);pass.setBindGroup(0,edgeBind);pass.draw(2,link.length/2);
 pass.setPipeline(particles);pass.setBindGroup(0,particleBind);pass.draw(4,fixture.graph.count);
 pass.end();
 encoder.copyTextureToBuffer({texture:target},{buffer:read,bytesPerRow:width*4,rowsPerImage:height},
  {width,height,depthOrArrayLayers:1});
 device.queue.submit([encoder.finish()]);
 await device.queue.onSubmittedWorkDone();
 const error=await device.popErrorScope();
 if(error)throw Error('Render GPU validation: '+error.message);
 await read.mapAsync(GPUMapMode.READ);
 const pixels=new Uint8Array(read.getMappedRange());
 let lit=0;
 for(let i=0;i<pixels.length;i+=4)if(pixels[i]>22||pixels[i+1]>22||pixels[i+2]>25)lit++;
 read.unmap();
 console.log(JSON.stringify({mode,particles:fixture.graph.count,candidateEdges:link.length/2,
  litPixels:lit,pass:lit>200}));
 if(lit<=200)throw Error('Blank render');
 solver.destroy();read.destroy();target.destroy();viewBuffer.destroy();edgeBuffer.destroy();
}
await run('bonded',6,6,3);
await run('dynamic',8,8,4);
await run('bonded',24,24,12,64);
device.destroy();console.log('PASS spring particles and GPU connection lines render');
