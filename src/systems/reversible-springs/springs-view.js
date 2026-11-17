import {createLatticeFixture,createSphereFixture,springPairs,dynamicPairs,referenceLatticeSegments,cubicGridDimensions} from './springs-cpu.mjs?v=cube1';
import {ReversibleSpringsGPU} from './springs-gpu.js?v=live4';
import {ReversibleFlockGPU} from './flock-gpu.js?v=boids1';
import {seedMovingFlock,flockPairs} from './flock-cpu.mjs?v=boids1';
import {generateProjectedH4Lattice} from './downprojected-h4-lattice.mjs?v=h4-1';
import {generateProjectedE8H3Lattice} from './downprojected-e8-h3-lattice.mjs?v=e8-1';
import {RateMeter,formatRate,formatMs} from '../../diagnostics/rate-meter.js?v=stats1';

const $=id=>document.getElementById(id);
const canvas=$('view');
const status=$('status');
const ticks=$('ticks');
const gpuLabel=$('gpu');
const formatLabel=$('format');
let device=null,context=null,renderPipeline=null,edgePipeline=null,velocityPipeline=null,velocityGroups=null,boxPipeline=null,boxGroup=null,latticePipeline=null,latticeGroup=null,latticeBuffer=null,latticeCount=0,viewBuffer=null,solver=null,renderGroups=null,edgeGroups=null,edgeBuffer=null,edgeCount=0;
let trailFadePipeline=null,trailComposePipeline=null,trailSampler=null,trailUniform=null;
let trailTextures=[],trailBindings=[],trailSize=[0,0],trailCurrent=0,trailValid=false,trailBindLayout=null;
let h4Pipeline=null,h4Buffer=null,h4Group=null,h4Count=0;
let playing=false,playbackDirection=1,loading=false,angleX=-0.55,angleY=0.4,zoom=1;
let graphSize=[6,6,6],lastFrame=performance.now(),flockOrigin=[0,0,0],flockDrift=[0,0,0];
let latticeSettings={nx:6,ny:6,nz:6,spacing:96,precision:32};
const U=()=>globalThis.GPUBufferUsage;
function note(message){status.textContent=message;}
function fixtureSettings(){
 let side=Number($('grid').value);
 const mode=$('connectivity').value,shape=$('shape').value;
 if((mode==='dynamic'||mode==='flock')&&side>8){
  side=8;
  $('grid').value='8';
 }
 const spacing=Math.max(12,Math.round(480/(side-1)));
 return {
  ...cubicGridDimensions(side),
  side,spacing,precision:Number($('precision').value),
  stiffness:Number($('stiffness').value),
  perturbation:Math.min(96,Math.round(Number($('perturb').value)*spacing/96)),
  cutoff:Math.round(spacing*Number($('contactRange').value)/100),
  restLength:spacing,restScale256:Math.round(Number($('restScale').value)*256/100),
  mode,shape
 };
}
async function initGPU(){
 const adapter=await navigator.gpu?.requestAdapter({powerPreference:'high-performance'});
 if(!adapter)throw Error('WebGPU adapter unavailable');
 device=await adapter.requestDevice();
 device.lost.then(info=>{playing=false;note('GPU device lost: '+(info?.message||'unknown'));});
 context=canvas.getContext('webgpu');
 const format=navigator.gpu.getPreferredCanvasFormat();
 context.configure({device,format,alphaMode:'opaque'});
 gpuLabel.textContent=adapter.info?.description||adapter.info?.device||'WebGPU adapter';
 formatLabel.textContent=format;
 const response=await fetch(new URL('./springs-render.wgsl',import.meta.url),{cache:'no-store'});
 if(!response.ok)throw Error('Spring renderer HTTP '+response.status);
 const module=device.createShaderModule({label:'Lapinet springs GPU renderer',code:await response.text()});
 const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
 if(errors.length)throw Error('Render WGSL: '+errors.map(x=>x.lineNum+':'+x.message).join('; '));
 renderPipeline=await device.createRenderPipelineAsync({
  label:'Lapinet reversible springs particle viewer',
  layout:'auto',
  vertex:{module,entryPoint:'vertexMain'},
  fragment:{module,entryPoint:'fragmentMain',targets:[{format}]},
  primitive:{topology:'triangle-strip'},
 });
 edgePipeline=await device.createRenderPipelineAsync({
  label:'Lapinet GPU spring connections',
  layout:'auto',
  vertex:{module,entryPoint:'edgeVertex'},
  fragment:{module,entryPoint:'edgeFragment',targets:[{
   format,
   blend:{
    color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},
    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}
   }
  }]},
  primitive:{topology:'line-list'},
 });
 velocityPipeline=await device.createRenderPipelineAsync({
  label:'Sparse flock heading arrows',
  layout:'auto',
  vertex:{module,entryPoint:'velocityVertex'},
  fragment:{module,entryPoint:'edgeFragment',targets:[{
   format,
   blend:{
    color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},
    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}
   }
  }]},
  primitive:{topology:'line-list'}
 });
 boxPipeline=await device.createRenderPipelineAsync({
  label:'Reflective enclosure wireframe',
  layout:'auto',
  vertex:{module,entryPoint:'boxVertex'},
  fragment:{module,entryPoint:'edgeFragment',targets:[{
   format,
   blend:{
    color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},
    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}
   }
  }]},
  primitive:{topology:'line-list'}
 });
 h4Pipeline=await device.createRenderPipelineAsync({
  label:'Projected E8/H3 or H4 golden lattice edges',
  layout:'auto',
  vertex:{module,entryPoint:'h4Vertex'},
  fragment:{module,entryPoint:'edgeFragment',targets:[{
   format,blend:{
    color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},
    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}
   }
  }]},primitive:{topology:'line-list'}
 });
 latticePipeline=await device.createRenderPipelineAsync({
  label:'Lapinet stationary 3D lattice',
  layout:'auto',
  vertex:{module,entryPoint:'latticeVertex'},
  fragment:{module,entryPoint:'edgeFragment',targets:[{
   format,blend:{
    color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},
    alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}
   }
  }]},primitive:{topology:'line-list'}
 });
 viewBuffer=device.createBuffer({label:'Spring viewer camera',size:80,usage:U().UNIFORM|U().COPY_DST});
 boxGroup=device.createBindGroup({
  layout:boxPipeline.getBindGroupLayout(0),
  entries:[{binding:1,resource:{buffer:viewBuffer}}]
 });
 const trailsResponse=await fetch(new URL('./springs-trails.wgsl',import.meta.url),{cache:'no-store'});
 if(!trailsResponse.ok)throw Error('Trails shader HTTP '+trailsResponse.status);
 const trailsModule=device.createShaderModule({label:'Screen-space particle trails',code:await trailsResponse.text()});
 const trailErrors=(await trailsModule.getCompilationInfo()).messages.filter(m=>m.type==='error');
 if(trailErrors.length)throw Error('Trails WGSL: '+trailErrors.map(e=>e.lineNum+':'+e.message).join('; '));
 const trailLayout=device.createBindGroupLayout({entries:[
  {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'float'}},
  {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:'filtering'}},
  {binding:2,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}}
 ]});
 const trailPipelineLayout=device.createPipelineLayout({bindGroupLayouts:[trailLayout]});
 trailFadePipeline=await device.createRenderPipelineAsync({
  label:'Trails history decay',layout:trailPipelineLayout,
  vertex:{module:trailsModule,entryPoint:'trailVertex'},
  fragment:{module:trailsModule,entryPoint:'trailFade',targets:[{format}]},
  primitive:{topology:'triangle-list'}
 });
 trailComposePipeline=await device.createRenderPipelineAsync({
  label:'Trails additive composite',layout:trailPipelineLayout,
  vertex:{module:trailsModule,entryPoint:'trailVertex'},
  fragment:{module:trailsModule,entryPoint:'trailCompose',targets:[{
   format,blend:{
    color:{srcFactor:'one',dstFactor:'one',operation:'add'},
    alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}
   }
  }]},
  primitive:{topology:'triangle-list'}
 });
 trailUniform=device.createBuffer({label:'Trail persistence',size:16,usage:U().UNIFORM|U().COPY_DST});
 trailSampler=device.createSampler({minFilter:'linear',magFilter:'linear'});
 trailBindLayout=trailLayout;
}
function rebuildProjectedLattice(){
 if(!device||!h4Pipeline)return;
 h4Buffer?.destroy();h4Buffer=null;h4Group=null;h4Count=0;
 const mode=$('h4Projection').value;
 const h4=mode.startsWith('h4-');
 $('h4Radius').disabled=!h4;
 if(mode==='off'){$('h4Info').textContent='off';$('projectionNote').textContent='Projection disabled';return;}
 const worldScale=latticeSettings.spacing*latticeSettings.precision*1.5;
 const sample=h4?
  generateProjectedH4Lattice({
   radius:Number($('h4Radius').value),
   projection:mode==='h4-hopf'?'hopf':'orthographic',
   worldScale
  }):
  generateProjectedE8H3Lattice({
   kind:mode==='e8-shell'?'shell':'q6',worldScale
  });
 h4Count=sample.edgeCount;
 if(h4Count){
  h4Buffer=device.createBuffer({
   label:'Downprojected golden lattice edge segments',
   size:sample.vertices.byteLength,
   usage:U().STORAGE|U().COPY_DST
  });
  device.queue.writeBuffer(h4Buffer,0,sample.vertices);
  h4Group=device.createBindGroup({
   layout:h4Pipeline.getBindGroupLayout(0),
   entries:[
    {binding:1,resource:{buffer:viewBuffer}},
    {binding:3,resource:{buffer:h4Buffer}}
   ]
  });
 }
 $('h4Info').textContent=(h4?
  sample.siteCount.toLocaleString()+' Z[φ] coefficient sites / ':
  sample.sourceRootCount.toLocaleString()+' E8 roots / ')+
  sample.distinctProjectedSites.toLocaleString()+' projected sites / '+
  h4Count.toLocaleString()+(mode==='e8-q6'?' Q6 sign-flip edges':' projected root edges');
 $('projectionNote').textContent=h4?
  'H4 quaternion slice/Hopf: separate coefficient model, not E8 → H3':
  mode==='e8-q6'?
  'E8 → H3 golden: 64 spinor sites and 192 combinatorial Q6 edges':
  'E8 → H3 golden: 240 roots, 137 distinct projected sites; edges preserve E8 adjacency';
}
function rebuildReferenceLattice(){
 if(!device||!latticePipeline)return;
 latticeBuffer?.destroy();
 latticeBuffer=null;latticeGroup=null;latticeCount=0;
 const density=Number($('latticeDetail').value);
 if(!density){$('latticeInfo').textContent='off';return;}
 const grid=referenceLatticeSegments(latticeSettings,density);
 latticeCount=grid.edgeCount;
 if(latticeCount){
  latticeBuffer=device.createBuffer({
   label:'Stationary 3D reference lattice',size:grid.vertices.byteLength,
   usage:U().STORAGE|U().COPY_DST
  });
  device.queue.writeBuffer(latticeBuffer,0,grid.vertices);
  latticeGroup=device.createBindGroup({
   layout:latticePipeline.getBindGroupLayout(0),
   entries:[
    {binding:1,resource:{buffer:viewBuffer}},
    {binding:3,resource:{buffer:latticeBuffer}}
   ]
  });
 }
 $('latticeInfo').textContent=grid.siteCount.toLocaleString()+' sites · '+
  latticeCount.toLocaleString()+' lines ('+grid.sampledAxes.join('×')+')';
}
function ensureTrailBuffers(){
 if(!device||!trailFadePipeline)return;
 if(trailSize[0]===canvas.width&&trailSize[1]===canvas.height)return;
 for(const texture of trailTextures)texture.destroy();
 trailSize=[canvas.width,canvas.height];
 trailTextures=[0,1].map(i=>device.createTexture({
  label:'Particle trail history '+i,
  size:[canvas.width,canvas.height,1],
  format:navigator.gpu.getPreferredCanvasFormat(),
  usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING
 }));
 trailBindings=trailTextures.map(texture=>device.createBindGroup({
  layout:trailBindLayout,
  entries:[
   {binding:0,resource:texture.createView()},
   {binding:1,resource:trailSampler},
   {binding:2,resource:{buffer:trailUniform}}
  ]
 }));
 trailCurrent=0;trailValid=false;
}
function updateTrailHistory(){
 if(!$('showTrails').checked||!trailFadePipeline)return null;
 ensureTrailBuffers();
 const dst=1-trailCurrent;
 device.queue.writeBuffer(trailUniform,0,
  new Float32Array([Number($('trailPersistence').value)/100,0,0,0]));
 const encoder=device.createCommandEncoder({label:'Screen-space trail history'});
 const pass=encoder.beginRenderPass({
  colorAttachments:[{view:trailTextures[dst].createView(),
   clearValue:{r:0,g:0,b:0,a:1},loadOp:'clear',storeOp:'store'}]
 });
 if(trailValid){
  pass.setPipeline(trailFadePipeline);
  pass.setBindGroup(0,trailBindings[trailCurrent]);
  pass.draw(3);
 }
 pass.setPipeline(renderPipeline);
 pass.setBindGroup(0,renderGroups[solver.current]);
 pass.draw(4,solver.graph.count);
 pass.end();
 device.queue.submit([encoder.finish()]);
 trailCurrent=dst;trailValid=true;
 return trailBindings[dst];
}
async function reset({autoplay=false}={}){
 if(loading)return;
 loading=true;playing=false;updateControls();note('Building spring lattice…');
 try{
  const cfg=fixtureSettings();
  let fixture=cfg.shape==='sphere'?
   createSphereFixture({...cfg,mode:cfg.mode==='flock'?'dynamic':cfg.mode==='straight'?'bonded':cfg.mode}):
   createLatticeFixture({...cfg,mode:cfg.mode==='flock'?'dynamic':cfg.mode==='straight'?'bonded':cfg.mode});
  if(cfg.mode==='flock'){
   fixture=seedMovingFlock(fixture,{
    velocity:2,scatter:0.28,pattern:'counterflow',
    alignment:Number($('alignment').value),
    coupling:Number($('coupling').value)
   });
   Object.assign(fixture.graph,{
    cohesion:Number($('cohesion').value),
    separation:Number($('separation').value),
    steering:Number($('steering').value),
    goalX:Math.round(cfg.spacing*(cfg.side-1)*0.4)*cfg.precision
   });
  }
  if(cfg.mode==='straight'){
   fixture=seedMovingFlock(fixture,{velocity:1.3,scatter:0.6});
   Object.assign(fixture.graph,{mode:'straight',stiffness:0,alignment:0,coupling:0});
  }
  if((cfg.mode==='flock'||cfg.mode==='straight')&&$('reflectBoundary').checked){
   fixture.graph.boundaryExtent=Math.round(
    cfg.spacing*((cfg.side-1)*0.63+0.4))*cfg.precision;
   $('followFlock').checked=false;
  }
  flockOrigin=[0,0,0];flockDrift=[0,0,0];
  if(cfg.mode==='flock'){
   for(let i=0;i<fixture.graph.count;i++)
    for(let axis=0;axis<3;axis++){
     flockOrigin[axis]+=fixture.state[i*8+axis]/fixture.graph.count;
     flockDrift[axis]+=Math.trunc(fixture.state[i*8+4+axis]/256)/fixture.graph.count;
    }
  }
  solver?.destroy();
  trailValid=false;
  edgeBuffer?.destroy();
  solver=(cfg.mode==='flock'||cfg.mode==='straight')?
   await ReversibleFlockGPU.create({device,fixture}):
   await ReversibleSpringsGPU.create({device,fixture});
  const pairs=cfg.mode==='straight'?new Uint32Array(0):
   (cfg.mode==='dynamic'||cfg.mode==='flock')?dynamicPairs(fixture.graph.count):springPairs(fixture.graph);
  edgeCount=pairs.length/2;
  edgeBuffer=device.createBuffer({
   label:'Spring connection IDs',size:Math.max(16,pairs.byteLength),
   usage:U().STORAGE|U().COPY_DST
  });
  device.queue.writeBuffer(edgeBuffer,0,pairs);
  edgeGroups=solver.states.map(state=>device.createBindGroup({
   layout:edgePipeline.getBindGroupLayout(0),
   entries:[
    {binding:0,resource:{buffer:state}},
    {binding:1,resource:{buffer:viewBuffer}},
    {binding:2,resource:{buffer:edgeBuffer}}
   ]
  }));
  renderGroups=solver.states.map(state=>device.createBindGroup({
   layout:renderPipeline.getBindGroupLayout(0),
   entries:[{binding:0,resource:{buffer:state}},{binding:1,resource:{buffer:viewBuffer}}],
  }));
  velocityGroups=solver.states.map(state=>device.createBindGroup({
   layout:velocityPipeline.getBindGroupLayout(0),
   entries:[{binding:0,resource:{buffer:state}},{binding:1,resource:{buffer:viewBuffer}}],
  }));
  graphSize=[cfg.nx,cfg.ny,cfg.nz];
  $('gridDimensions').textContent=
   graphSize.join(' × ')+' ('+graphSize.reduce((n,v)=>n*v,1).toLocaleString()+' source sites)';
  latticeSettings={nx:cfg.nx,ny:cfg.ny,nz:cfg.nz,spacing:cfg.spacing,precision:cfg.precision};
  rebuildReferenceLattice();
  rebuildProjectedLattice();
  $('count').textContent=String(fixture.graph.count);
  $('edges').textContent=cfg.mode==='straight'?'none (independent trajectories)':
   (cfg.mode==='dynamic'||cfg.mode==='flock')?
   edgeCount.toLocaleString()+' candidates (GPU filtered)':
   edgeCount.toLocaleString()+' bonds';
  $('resolutionInfo').textContent=
   spacingLabel(cfg.spacing)+' world units / node · 1/'+cfg.precision+' coordinate units';
  $('forceMode').textContent=cfg.mode==='straight'?'Constant-velocity integer drift':
   cfg.mode==='flock'?'Alignment + cohesion + separation + goal steering':
   cfg.mode==='dynamic'?'Dynamic contact radius':'Central bonded';
  $('flockNeighbors').textContent=cfg.mode==='flock'?
   (flockPairs(fixture.state,fixture.graph).length/2).toLocaleString()+
   ' initial active pairs; arrows sample every 3rd particle':'—';
  $('steeringGoal').textContent=cfg.mode==='flock'?
   'X = '+(fixture.graph.goalX/fixture.graph.precision).toFixed(0)+
   ' world units':'—';
  $('boundaryInfo').textContent=fixture.graph.boundaryExtent?
   '+/-'+(fixture.graph.boundaryExtent/fixture.graph.precision).toFixed(0)+' world units (six faces)':'off';
  note(cfg.mode==='flock'?
   'Reversible boids: alignment, cohesion, separation and +X steering · exact rewind':
   'GPU central pair forces · '+cfg.mode+' connectivity · integer exact inverse');
  playing=autoplay;
  playbackDirection=1;
 }catch(e){note('Initialization error: '+e.message);console.error(e)}
 finally{loading=false;updateControls()}
}
function spacingLabel(n){return n.toString()}
function updateControls(syncHistory=false){
 if(syncHistory&&solver&&!loading){
  const c=solver.coefficientsAt();
  $('stiffness').value=c.stiffness;
  $('restScale').value=Math.round(c.restScale256*100/256);
  $('contactRange').value=Math.round(c.cutoff*100/solver.graph.spacing);
  $('alignment').value=c.alignment??16;
  $('coupling').value=c.coupling??8;
  $('cohesion').value=c.cohesion??0;
  $('separation').value=c.separation??0;
  $('steering').value=c.steering??0;
 }
 $('play').textContent=playing&&playbackDirection===1?'Pause':'Play';
 $('reverse').textContent=playing&&playbackDirection===-1?'Pause':'Reverse';
 $('play').setAttribute('aria-pressed',String(playing&&playbackDirection===1));
 $('reverse').setAttribute('aria-pressed',String(playing&&playbackDirection===-1));
 $('play').disabled=!solver||loading;
 $('reverse').disabled=!solver||solver.tick===0||loading;
 $('followFlock').disabled=Boolean(solver?.graph.boundaryExtent)||solver?.graph.mode==='straight';
 const straight=solver?.graph.mode==='straight';
 $('showVelocity').disabled=!(solver&&['flock','straight'].includes(solver.graph.mode));
 for(const id of ['stiffness','alignment','coupling','restScale','contactRange'])
  $(id).disabled=Boolean(straight);
 const flock=solver?.graph.mode==='flock';
 for(const id of ['cohesion','separation','steering'])
  $(id).disabled=!flock;
 $('back').disabled=!solver||solver.tick===0||loading;
 $('back64').disabled=!solver||solver.tick===0||loading;
 $('forward').disabled=!solver||loading;
 $('forward64').disabled=!solver||loading;
 $('verify').disabled=!solver||loading;
 ticks.textContent=String(solver?.tick||0);
 $('stiffnessValue').textContent=$('stiffness').value;
 $('restScaleValue').textContent=$('restScale').value+'%';
 $('contactRangeValue').textContent=$('contactRange').value+'%';
 $('perturbValue').textContent=$('perturb').value;
 $('opacityValue').textContent=Math.round(Number($('edgeOpacity').value)*100)+'%';
 $('alignmentValue').textContent=$('alignment').value;
 $('couplingValue').textContent=$('coupling').value;
 $('cohesionValue').textContent=$('cohesion').value;
 $('separationValue').textContent=$('separation').value;
 $('steeringValue').textContent=$('steering').value;
 $('trailPersistenceValue').textContent=$('trailPersistence').value+'%';
}
function advance(n,reverse=false){
 if(!solver||loading)return;
 if(reverse&&solver.tick===0)return;
 const count=reverse?Math.min(solver.tick,n):n;
 if(count>0)solver.step(count,{reverse});
 updateControls(true);
}
function resize(){
 const width=Math.max(canvas.clientWidth,1);
 const height=Math.max(canvas.clientHeight,1);
 const ratio=Math.min(window.devicePixelRatio||1,2);
 canvas.width=Math.max(1,Math.floor(width*ratio));
 canvas.height=Math.max(1,Math.floor(height*ratio));
}
function render(){
 // reset() destroys the old solver before awaiting the new one; skip frames in between.
 if(loading||!solver||!device||!context||!renderPipeline)return;
 if(canvas.width<1||canvas.height<1)resize();
 const extent=Math.max(...graphSize)*solver.graph.spacing*solver.graph.precision;
 const scale=zoom*1.75/extent;
 device.queue.writeBuffer(viewBuffer,0,new Float32Array([
  canvas.width,canvas.height,scale,
  Math.max(1.2,4.3*6/Math.max(...graphSize))*(window.devicePixelRatio||1),
  angleX,angleY,Number($('edgeOpacity').value),
  (solver.graph.mode==='dynamic'||solver.graph.mode==='flock')?
   (solver.graph.cutoff*solver.graph.precision)**2:-1,
 ]));
 device.queue.writeBuffer(viewBuffer,32,new Int32Array([
  solver.graph.precision,solver.graph.cutoff**2,
  (solver.graph.mode==='dynamic'||solver.graph.mode==='flock')?1:0,0
 ]));
 const useFollow=solver.graph.mode==='flock'&&!solver.graph.boundaryExtent&&$('followFlock').checked;
 device.queue.writeBuffer(viewBuffer,48,new Float32Array([
  ...(useFollow?flockOrigin.map((v,i)=>v+solver.tick*flockDrift[i]):[0,0,0]),0
 ]));
 device.queue.writeBuffer(viewBuffer,64,new Float32Array([
  solver.graph.boundaryExtent??0,0,0,0
 ]));
 const trailGroup=updateTrailHistory();
 const enc=device.createCommandEncoder();
 const pass=enc.beginRenderPass({
  colorAttachments:[{view:context.getCurrentTexture().createView(),
   clearValue:{r:0.018,g:0.025,b:0.04,a:1},loadOp:'clear',storeOp:'store'}],
 });
 if(trailGroup){
  pass.setPipeline(trailComposePipeline);
  pass.setBindGroup(0,trailGroup);
  pass.draw(3);
 }
 if(solver.graph.boundaryExtent){
  pass.setPipeline(boxPipeline);
  pass.setBindGroup(0,boxGroup);
  pass.draw(24);
 }
 if(h4Group&&h4Count>0){
  pass.setPipeline(h4Pipeline);
  pass.setBindGroup(0,h4Group);
  pass.draw(2*h4Count);
 }
 if(latticeGroup&&latticeCount>0){
  pass.setPipeline(latticePipeline);
  pass.setBindGroup(0,latticeGroup);
  pass.draw(2*latticeCount);
 }
 if($('showEdges').checked&&edgeCount>0){
  pass.setPipeline(edgePipeline);
  pass.setBindGroup(0,edgeGroups[solver.current]);
  pass.draw(2,edgeCount);
 }
 if($('showVelocity').checked&&velocityGroups&&
    (solver.graph.mode==='flock'||solver.graph.mode==='straight')){
  pass.setPipeline(velocityPipeline);
  pass.setBindGroup(0,velocityGroups[solver.current]);
  pass.draw(6,Math.ceil(solver.graph.count/3));
 }
 pass.setPipeline(renderPipeline);
 pass.setBindGroup(0,renderGroups[solver.current]);
 pass.draw(4,solver.graph.count);
 pass.end();device.queue.submit([enc.finish()]);
}
function frame(now){
 try{
  if(playing&&solver){
   // Both directions use the same exact GPU solver and live coefficient history.
   if(playbackDirection<0&&solver.tick===0){
    playing=false;
    updateControls();
   }else{
    advance(solver.graph.mode==='flock'?1:2,playbackDirection<0);
    if(playbackDirection<0&&solver.tick===0){
     playing=false;
     updateControls();
    }
   }
  }
  render();
  renderedFrames++;
  updatePerf(now);
 }catch(e){playing=false;note('Runtime error: '+e.message);console.error(e)}
 requestAnimationFrame(frame);
}
// HUD performance readout: render FPS and solver ticks/s (wall-clock cadence only).
const fpsMeter=new RateMeter({windowMs:500}),tickMeter=new RateMeter({windowMs:500});
let renderedFrames=0,lastPerfPaint=-Infinity;
function updatePerf(now){
 const fps=fpsMeter.update(renderedFrames,now);
 const tickRate=tickMeter.update(solver?.tick||0,now);
 if(now-lastPerfPaint<250)return;
 lastPerfPaint=now;
 $('fps').textContent=formatRate(fps);
 $('frameMs').textContent=formatMs(fpsMeter.period);
 $('tickRate').textContent=formatRate(playing?tickRate:0);
 $('playState').textContent=loading?'loading':!solver?'—':
  playing?(playbackDirection<0?'reverse':'forward'):'stopped';
}
function activateFlockDemo(){
 if(loading)return;
 $('shape').value='sphere';
 $('grid').value='8';
 $('connectivity').value='flock';
 $('stiffness').value='20';
 $('restScale').value='91';
 $('contactRange').value='210';
 $('perturb').value='15';
 $('alignment').value='0';
 $('coupling').value='0';
 $('cohesion').value='2';
 $('separation').value='6';
 $('steering').value='2';
 $('edgeOpacity').value='.55';
 $('showTrails').checked=true;
 $('trailPersistence').value='95';
 $('showEdges').checked=false;
 $('showVelocity').checked=true;
 $('h4Projection').value='off';
 $('latticeDetail').value='0';
 $('followFlock').checked=false;
 $('reflectBoundary').checked=true;
 void reset({autoplay:true});
}
$('flockDemo').addEventListener('click',activateFlockDemo);
$('play').addEventListener('click',()=>{
 if(!solver||loading)return;
 playing=!(playing&&playbackDirection===1);
 playbackDirection=1;
 updateControls();
});
$('reverse').addEventListener('click',()=>{
 if(!solver||loading||solver.tick===0)return;
 playing=!(playing&&playbackDirection===-1);
 playbackDirection=-1;
 updateControls();
});
$('forward').addEventListener('click',()=>{playing=false;advance(1)});
$('back').addEventListener('click',()=>{playing=false;advance(1,true)});
$('forward64').addEventListener('click',()=>{playing=false;advance(64)});
$('back64').addEventListener('click',()=>{playing=false;advance(64,true)});
$('reset').addEventListener('click',()=>{void reset({autoplay:false})});
$('verify').addEventListener('click',async()=>{
 if(!solver)return;
 playing=false;updateControls();note('Checking GPU↔CPU parity and 64-tick exact rewind…');
 $('verify').disabled=true;
 try{
  const r=await solver.certify({roundtrip:64});
  note((r.passed?'PASS':'FAIL')+' · GPU↔CPU mismatches '+r.cpuMismatches+
   ' · inverse mismatches '+r.inverseMismatches+' · momentum ['+r.momentum.join(', ')+
   '] · checksum 0x'+r.checksum.toString(16));
 }catch(e){note('Verification failed: '+e.message);console.error(e)}
 finally{updateControls()}
});
for(const id of ['grid','perturb','precision','shape','connectivity']){
 $(id).addEventListener('input',()=>{playing=false;updateControls()});
 $(id).addEventListener('change',()=>{
  if(id==='connectivity'&&$('connectivity').value==='flock'){
   activateFlockDemo();
   return;
  }
  if(id==='connectivity'&&$('connectivity').value==='straight'){
   $('shape').value='sphere';
   $('grid').value='8';
   $('stiffness').value='0';
   $('perturb').value='0';
   $('alignment').value='0';
   $('coupling').value='0';
   $('cohesion').value='0';
   $('separation').value='0';
   $('steering').value='0';
   $('showVelocity').checked=true;
  }else if(id==='connectivity'){
   $('stiffness').value='20';
   $('perturb').value='15';
   $('showVelocity').checked=false;
  }
  void reset({autoplay:false});
 });
}
$('reflectBoundary').addEventListener('change',()=>{void reset({autoplay:false})});
$('latticeDetail').addEventListener('change',rebuildReferenceLattice);
$('h4Projection').addEventListener('change',()=>{rebuildProjectedLattice();trailValid=false});
$('h4Radius').addEventListener('change',()=>{rebuildProjectedLattice();trailValid=false});
$('showTrails').addEventListener('change',()=>{trailValid=false;updateControls()});
$('trailPersistence').addEventListener('input',updateControls);
$('showEdges').addEventListener('change',updateControls);
$('showVelocity').addEventListener('change',updateControls);
$('toggleHud').addEventListener('click',()=>{
 const hud=$('canvasHud');
 hud.hidden=!hud.hidden;
 $('toggleHud').textContent=hud.hidden?'Show HUD':'Hide HUD';
 $('toggleHud').setAttribute('aria-pressed',String(!hud.hidden));
});
$('edgeOpacity').addEventListener('input',updateControls);
function applyLiveCoefficients(){
 if(!solver||loading)return;
 try{
  const c=solver.setCoefficients({
   stiffness:Number($('stiffness').value),
   restScale256:Math.round(Number($('restScale').value)*256/100),
   cutoff:Math.round(solver.graph.spacing*Number($('contactRange').value)/100),
   alignment:Number($('alignment').value),
   coupling:Number($('coupling').value),
   cohesion:Number($('cohesion').value),
   separation:Number($('separation').value),
   steering:Number($('steering').value),
  });
  note('Live at tick '+solver.tick+
   ' · spring '+c.stiffness+
   ' · rest '+(c.restScale256/256).toFixed(3)+
   ' · contact radius '+c.cutoff+
   ' · cohesion '+c.cohesion+' · separation '+c.separation+
   ' · goal steering '+c.steering+' · recorded for exact rewind');
 }catch(error){note('Live coefficient error: '+error.message)}
 updateControls();
}
for(const id of ['stiffness','restScale','contactRange','alignment','coupling',
 'cohesion','separation','steering']){
 $(id).addEventListener('input',applyLiveCoefficients);
}
let drag=null;
canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{
 if(!drag)return;
 trailValid=false;
 angleX+=(e.clientX-drag.x)*.008;
 angleY=Math.max(-1.4,Math.min(1.4,angleY+(e.clientY-drag.y)*.008));
 drag={x:e.clientX,y:e.clientY};
});
canvas.addEventListener('pointerup',()=>{drag=null});
canvas.addEventListener('pointercancel',()=>{drag=null});
canvas.addEventListener('wheel',e=>{e.preventDefault();trailValid=false;zoom=Math.max(.3,Math.min(5,zoom*Math.exp(-e.deltaY*.001)))},{passive:false});
window.addEventListener('resize',resize);
async function start(){
 if(!navigator.gpu){note('This browser does not provide WebGPU');return;}
 try{
  await initGPU();
  resize();
  await reset({autoplay:true});
  requestAnimationFrame(frame);
 }catch(e){note('WebGPU initialization failed: '+e.message);console.error(e)}
}
void start();
