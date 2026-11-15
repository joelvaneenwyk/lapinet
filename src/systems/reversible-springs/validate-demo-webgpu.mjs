import {generateProjectedE8H3Lattice} from './downprojected-e8-h3-lattice.mjs';
const adapter=await navigator.gpu?.requestAdapter();
if(!adapter)throw Error('WebGPU adapter unavailable');
const device=await adapter.requestDevice();
const U=GPUBufferUsage,T=GPUTextureUsage,F='rgba8unorm';
const renderer=device.createShaderModule({code:await Deno.readTextFile(
 new URL('./springs-render.wgsl',import.meta.url))});
const trails=device.createShaderModule({code:await Deno.readTextFile(
 new URL('./springs-trails.wgsl',import.meta.url))});
for(const [name,module] of [['renderer',renderer],['trails',trails]]){
 const errors=(await module.getCompilationInfo()).messages.filter(x=>x.type==='error');
 if(errors.length)throw Error(name+' WGSL: '+errors.map(x=>x.lineNum+':'+x.message).join('; '));
}
const blend={color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},
 alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}};
const edges=async entry=>device.createRenderPipelineAsync({layout:'auto',
 vertex:{module:renderer,entryPoint:entry},
 fragment:{module:renderer,entryPoint:'edgeFragment',targets:[{format:F,blend}]},
 primitive:{topology:'line-list'}});
const [cart,h4,box,velocity]=await Promise.all([
 edges('latticeVertex'),edges('h4Vertex'),edges('boxVertex'),
 edges('velocityVertex')]);
const layout=device.createBindGroupLayout({entries:[
 {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
 {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
 {binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}
]});
const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
const fade=await device.createRenderPipelineAsync({
 layout:pipelineLayout,vertex:{module:trails,entryPoint:'trailVertex'},
 fragment:{module:trails,entryPoint:'trailFade',targets:[{format:F}]},
 primitive:{topology:'triangle-list'}});
const compose=await device.createRenderPipelineAsync({
 layout:pipelineLayout,vertex:{module:trails,entryPoint:'trailVertex'},
 fragment:{module:trails,entryPoint:'trailCompose',targets:[{
  format:F,blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},
   alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}}
 }]},
 primitive:{topology:'triangle-list'}});
const make=(label,size,usage)=>device.createBuffer({label,size,usage});
const view=make('viewer',80,U.UNIFORM|U.COPY_DST);
device.queue.writeBuffer(view,0,new Float32Array([256,256,0.0001,3,-0.55,0.4,0.5,-1]));
device.queue.writeBuffer(view,32,new Int32Array([32,9999,0,0]));
device.queue.writeBuffer(view,48,new Float32Array([0,0,0,0]));
device.queue.writeBuffer(view,64,new Float32Array([0,0,0,0]));
const grid=generateProjectedE8H3Lattice({kind:'q6',worldScale:3200});
const rootShell=generateProjectedE8H3Lattice({kind:'shell',worldScale:3200});
if(grid.edgeCount!==192||rootShell.distinctProjectedSites!==137||
   rootShell.edgeCount!==2752)
 throw Error('Incorrect canonical E8/H3 projected lattice');
const lattice=make('E8/H3 golden Q6 vertices',grid.vertices.byteLength,U.STORAGE|U.COPY_DST);
device.queue.writeBuffer(lattice,0,grid.vertices);
const group=device.createBindGroup({layout:h4.getBindGroupLayout(0),
 entries:[{binding:1,resource:{buffer:view}},{binding:3,resource:{buffer:lattice}}]});
const particle=make('counterflow direction glyph sample',32,U.STORAGE|U.COPY_DST);
device.queue.writeBuffer(particle,0,new Int32Array([
 0,0,0,0,32*256*2,32*256,0,0
]));
const directionGroup=device.createBindGroup({
 layout:velocity.getBindGroupLayout(0),entries:[
  {binding:0,resource:{buffer:particle}},
  {binding:1,resource:{buffer:view}}
 ]
});
const texture=label=>device.createTexture({label,size:[256,256,1],format:F,
 usage:T.RENDER_ATTACHMENT|T.TEXTURE_BINDING|T.COPY_SRC});
const historyA=texture('A'),historyB=texture('B'),output=texture('output');
const uniform=make('decay',16,U.UNIFORM|U.COPY_DST);
device.queue.writeBuffer(uniform,0,new Float32Array([.85,0,0,0]));
const sampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
const trailBinding=tex=>device.createBindGroup({layout,entries:[
 {binding:0,resource:tex.createView()},
 {binding:1,resource:sampler},
 {binding:2,resource:{buffer:uniform}}
]});
const fromA=trailBinding(historyA),fromB=trailBinding(historyB);
const clear={r:0,g:0,b:0,a:1};
device.pushErrorScope('validation');
const encoder=device.createCommandEncoder();
let pass=encoder.beginRenderPass({colorAttachments:[{
 view:historyA.createView(),loadOp:'clear',storeOp:'store',clearValue:clear
}]});
pass.setPipeline(h4);pass.setBindGroup(0,group);pass.draw(grid.edgeCount*2);
pass.setPipeline(velocity);pass.setBindGroup(0,directionGroup);pass.draw(6,1);
pass.end();
pass=encoder.beginRenderPass({colorAttachments:[{
 view:historyB.createView(),loadOp:'clear',storeOp:'store',clearValue:clear
}]});
pass.setPipeline(fade);pass.setBindGroup(0,fromA);pass.draw(3);pass.end();
pass=encoder.beginRenderPass({colorAttachments:[{
 view:output.createView(),loadOp:'clear',storeOp:'store',clearValue:clear
}]});
pass.setPipeline(compose);pass.setBindGroup(0,fromB);pass.draw(3);pass.end();
const staging=make('pixels',256*256*4,U.COPY_DST|U.MAP_READ);
encoder.copyTextureToBuffer({texture:output},{buffer:staging,bytesPerRow:1024,rowsPerImage:256},
 {width:256,height:256,depthOrArrayLayers:1});
device.queue.submit([encoder.finish()]);
await staging.mapAsync(GPUMapMode.READ);
let lit=0;
const pixels=new Uint8Array(staging.getMappedRange());
for(let i=0;i<pixels.length;i+=4)if(pixels[i]>10||pixels[i+1]>10||pixels[i+2]>10)lit++;
staging.unmap();
const error=await device.popErrorScope();
if(error)throw Error('GPU visual pipeline error: '+error.message);
if(lit<20)throw Error('Empty E8/H3 / trail composite: '+lit+' lit pixels');
console.log(JSON.stringify({status:'PASS',rendererWGSL:'ok',trailsWGSL:'ok',
 pipelines:['Cartesian','E8/H3 Q6','boundary','velocityArrows','trailFade','trailCompose'],
 q6Sites:grid.siteCount,q6Edges:grid.edgeCount,e8RootSites:rootShell.distinctProjectedSites,
 e8VisibleEdges:rootShell.edgeCount,compositeLitPixels:lit}));
staging.destroy();uniform.destroy();view.destroy();lattice.destroy();particle.destroy();
historyA.destroy();historyB.destroy();output.destroy();device.destroy();
