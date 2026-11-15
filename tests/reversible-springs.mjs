import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createLatticeFixture,validateGraph,forces,step,evolve,momentum,checksum
} from '../src/systems/reversible-springs/springs-cpu.mjs';

test('demo grid uses true NxNxN geometry through ultra resolution',async()=>{
 const {cubicGridDimensions,referenceLatticeSegments,springPairs}=await import(
  '../src/systems/reversible-springs/springs-cpu.mjs');
 for(const side of [6,8,12,16,20,24]){
  const dimensions=cubicGridDimensions(side);
  assert.deepEqual(dimensions,{nx:side,ny:side,nz:side});
  const spacing=21,precision=64;
  const {graph,state}=createLatticeFixture({
   ...dimensions,spacing,precision,perturbation:0,stiffness:18
  });
  assert.equal(graph.count,side**3);
  assert.equal(graph.indices.length,6*side*side*(side-1));
  assert.equal(springPairs(graph).length,3*side*side*(side-1)*2);
  const mins=Array(3).fill(Infinity),maxs=Array(3).fill(-Infinity);
  for(let i=0;i<state.length;i+=8)for(let axis=0;axis<3;axis++){
   mins[axis]=Math.min(mins[axis],state[i+axis]);
   maxs[axis]=Math.max(maxs[axis],state[i+axis]);
  }
  assert.deepEqual(mins,[mins[0],mins[0],mins[0]]);
  assert.deepEqual(maxs,[maxs[0],maxs[0],maxs[0]]);
  for(let axis=0;axis<3;axis++)
   assert.equal(maxs[axis]-mins[axis],(side-1)*spacing*precision);
  const sample=referenceLatticeSegments({...dimensions,spacing,precision},8);
  const resolution=Math.min(8,side);
  assert.deepEqual(sample.sampledAxes,[resolution,resolution,resolution]);
  assert.equal(sample.siteCount,resolution**3);
  assert.equal(sample.edgeCount,3*resolution*resolution*(resolution-1));
  for(let axis=0;axis<3;axis++){
   let minimum=Infinity,maximum=-Infinity;
   for(let i=0;i<sample.vertices.length;i+=4){
    minimum=Math.min(minimum,sample.vertices[i+axis]);
    maximum=Math.max(maximum,sample.vertices[i+axis]);
   }
   assert.equal(minimum,mins[axis]);
   assert.equal(maximum,maxs[axis]);
  }
  if(side===24){
   const advanced=evolve(state,graph,8);
   assert.deepEqual(evolve(advanced,graph,8,{reverse:true}),state);
  }
 }
 assert.throws(()=>cubicGridDimensions(25),/cube side/);
 assert.throws(()=>cubicGridDimensions(3.5),/cube side/);
});
test('directed spring CSR has exact equal/opposite integer edges',()=>{
 for(const [nx,ny,nz] of [[2,2,1],[6,6,3],[12,12,6]]){
  const {graph,state}=createLatticeFixture({nx,ny,nz});
  assert.equal(graph.count,nx*ny*nz);
  assert.equal(state.length,graph.count*8);
  assert.equal(validateGraph(graph),true);
  assert.equal(graph.indices.length%2,0);
 }
});
test('kick-drift states and linear momentum are integer exact',()=>{
 const {graph,state}=createLatticeFixture({nx:8,ny:8,nz:4});
 const original=momentum(state);
 let current=state;
 for(let t=0;t<256;t++){
  current=step(current,graph);
  assert.deepEqual(momentum(current),original);
  assert.ok(current.every(Number.isInteger));
 }
 assert.notEqual(checksum(state),checksum(current));
 for(let t=0;t<256;t++)current=step(current,graph,{reverse:true});
 assert.deepEqual(current,state);
});
test('all-particle force sum is identically zero at arbitrary deformation',()=>{
 const {graph,state}=createLatticeFixture({nx:8,ny:8,nz:4,stiffness:23});
 for(let i=0;i<state.length;i+=8){
  state[i]+=(i*13)%39;
  state[i+1]-=(i*17)%31;
  state[i+2]+=(i*7)%19;
 }
 const f=forces(state,graph);
 for(let axis=0;axis<3;axis++){
  let sum=0;
  for(let i=axis;i<f.length;i+=3)sum+=f[i];
  assert.equal(sum,0);
 }
});
test('long 10000-tick exact inversion of 16-particle spring network',()=>{
 const {graph,state}=createLatticeFixture({nx:4,ny:4,nz:1,stiffness:12,perturbation:6});
 const result=evolve(state,graph,10000);
 const restored=evolve(result,graph,10000,{reverse:true});
 assert.deepEqual(restored,state);
});


test('central impulses are torque-free for arbitrary integer positions',async()=>{
 const mod=await import('../src/systems/reversible-springs/springs-cpu.mjs');
 for(const mode of ['bonded','dynamic']){
  const {graph,state}=mod.createLatticeFixture({nx:4,ny:4,nz:2,mode,precision:32});
  const before=mod.angularMomentum(state);
  const kicked=mod.stage(state,graph,'kick');
  assert.deepEqual(mod.angularMomentum(kicked),before);
  assert.deepEqual(mod.momentum(kicked),mod.momentum(state));
 }
});
test('dynamic contacts appear and disappear as a pure position function',async()=>{
 const mod=await import('../src/systems/reversible-springs/springs-cpu.mjs');
 const {graph,state}=mod.createLatticeFixture({
  nx:2,ny:1,nz:1,mode:'dynamic',precision:32,spacing:96,perturbation:0,
  cutoff:132,restLength:96
 });
 assert.equal(mod.contactCount(state,graph),1);
 const initial=state.slice();
 initial[4]=-60*32*256;initial[12]=60*32*256;
 const departed=mod.step(initial,graph);
 assert.equal(mod.contactCount(departed,graph),0);
 assert.deepEqual(mod.step(departed,graph,{reverse:true}),initial);
 assert.equal(mod.contactCount(initial,graph),1);
});
test('fine coordinate units remain exactly reversible at sub-world motion',async()=>{
 const mod=await import('../src/systems/reversible-springs/springs-cpu.mjs');
 const {graph,state}=mod.createLatticeFixture({
  nx:2,ny:1,nz:1,precision:64,stiffness:0,perturbation:0
 });
 state[4]=256;
 const next=mod.step(state,graph);
 assert.equal(next[0]-state[0],1);
 assert.deepEqual(mod.step(next,graph,{reverse:true}),state);
});
test('dense 24 x 24 x 12 grid and spherical subset preserve stable IDs',async()=>{
 const mod=await import('../src/systems/reversible-springs/springs-cpu.mjs');
 const dense=mod.createLatticeFixture({
  nx:24,ny:24,nz:12,spacing:21,precision:64,perturbation:3
 });
 assert.equal(dense.graph.count,6912);
 assert.equal(mod.springPairs(dense.graph).length,dense.graph.indices.length);
 const sphere=mod.createSphereFixture({side:7,precision:32,mode:'dynamic'});
 assert.ok(sphere.graph.count>50&&sphere.graph.count<200);
 assert.equal(mod.dynamicPairs(sphere.graph.count).length,
  sphere.graph.count*(sphere.graph.count-1));
 assert.equal(mod.validateGraph(sphere.graph),true);
});

test('live coefficient timeline exactly reverses and branches after rewind',async()=>{
 const {SpringCoefficientTimeline,evolveWithCoefficients}=await import('../src/systems/reversible-springs/springs-timeline.mjs');
 const mod=await import('../src/systems/reversible-springs/springs-cpu.mjs');
 const {graph,state}=mod.createLatticeFixture({nx:4,ny:4,nz:2,precision:32});
 const timeline=new SpringCoefficientTimeline(graph);
 let evolved=evolveWithCoefficients(state,graph,timeline,0,6,mod.step);
 timeline.change(6,{stiffness:30});
 evolved=evolveWithCoefficients(evolved,graph,timeline,6,8,mod.step);
 timeline.change(14,{restScale256:326,cutoff:153});
 evolved=evolveWithCoefficients(evolved,graph,timeline,14,9,mod.step);
 const saved=evolved.slice();
 const restored=evolveWithCoefficients(saved,graph,timeline,23,23,mod.step,{reverse:true});
 assert.deepEqual(restored,state);
 assert.equal(timeline.at(2).stiffness,18);
 assert.equal(timeline.at(12).stiffness,30);
 assert.equal(timeline.at(18).restScale256,326);
 timeline.change(8,{stiffness:9});
 assert.equal(timeline.events.length,3);
 assert.equal(timeline.nextTick(8),Infinity);
 const branch=evolveWithCoefficients(evolveWithCoefficients(state,graph,timeline,0,8,mod.step),graph,timeline,8,7,mod.step);
 const back=evolveWithCoefficients(branch,graph,timeline,15,15,mod.step,{reverse:true});
 assert.deepEqual(back,state);
});

test('spherical flock aligns briefly and recovers every visible and hidden integer',async()=>{
 const {createSphereFixture}=await import('../src/systems/reversible-springs/springs-cpu.mjs');
 const {seedMovingFlock,evolveFlock,flockStats}=await import('../src/systems/reversible-springs/flock-cpu.mjs');
 for(const side of [5,7,8]){
  const original=seedMovingFlock(createSphereFixture({side,mode:'dynamic',spacing:24,
   cutoff:35,restLength:24,stiffness:0,precision:32,perturbation:0}));
  const before=flockStats(original.state,original.hidden,original.graph);
  const result=evolveFlock(original.state,original.hidden,original.graph,8);
  const after=flockStats(result.state,result.hidden,original.graph);
  assert.ok(after.velocityVariance/before.velocityVariance<0.75);
  assert.deepEqual(after.momentum,before.momentum);
  assert.deepEqual(after.hiddenTotals,before.hiddenTotals);
  const inverse=evolveFlock(result.state,result.hidden,original.graph,8,{reverse:true});
  assert.deepEqual(inverse.state,original.state);
  assert.deepEqual(inverse.hidden,original.hidden);
 }
});
test('counterflow flock demo visibly coordinates two streams and rewinds exactly',async()=>{
 const {createSphereFixture}=await import(
  '../src/systems/reversible-springs/springs-cpu.mjs');
 const {seedMovingFlock,evolveFlock,flockStats}=await import(
  '../src/systems/reversible-springs/flock-cpu.mjs');
 const f=seedMovingFlock(createSphereFixture({
  side:8,spacing:69,cutoff:117,restLength:69,stiffness:0,
  precision:32,perturbation:0,mode:'dynamic'
 }),{velocity:2,scatter:0.28,pattern:'counterflow',alignment:16,coupling:8});
 assert.equal(f.graph.count,160);
 assert.equal(f.graph.alignment,16);
 assert.equal(f.graph.coupling,8);
 let incomingLeft=0,incomingRight=0;
 for(let i=0;i<f.graph.count;i++){
  const p=i*8;
  if(f.state[p]<0){assert.ok(f.state[p+4]>0);incomingLeft++;}
  else{assert.ok(f.state[p+4]<0);incomingRight++;}
 }
 assert.ok(incomingLeft>0&&incomingRight>0);
 f.graph.boundaryExtent=10592;
 const initial=flockStats(f.state,f.hidden,f.graph);
 assert.ok(initial.pairCount>=500);
 const later=evolveFlock(f.state,f.hidden,f.graph,60);
 const after=flockStats(later.state,later.hidden,f.graph);
 // A diagnostic for the reproducible preset, NOT asymptotic
 // convergence: reversible shears cannot dissipate phase information.
 assert.ok(after.velocityVariance<initial.velocityVariance*0.25,
  'Counterflow demonstration should visibly align during first 60 ticks');
 const recovered=evolveFlock(later.state,later.hidden,f.graph,60,{reverse:true});
 assert.deepEqual(recovered.state,f.state);
 assert.deepEqual(recovered.hidden,f.hidden);
 assert.throws(()=>seedMovingFlock(f,{pattern:'unknown'}),/seed/);
});
test('cohesion, separation, and waypoint steering are distinct reversible kicks',async()=>{
 const {boidKick,seedMovingFlock,stepFlock,evolveFlock}=await import(
  '../src/systems/reversible-springs/flock-cpu.mjs');
 const {createLatticeFixture}=await import(
  '../src/systems/reversible-springs/springs-cpu.mjs');
 const pair=seedMovingFlock(createLatticeFixture({
  nx:2,ny:1,nz:1,spacing:20,cutoff:100,restLength:20,
  precision:32,stiffness:0,perturbation:0,mode:'dynamic'
 }),{velocity:0,scatter:0});
 const graph={...pair.graph,cohesion:16,separation:0,steering:0};
 const source=pair.state.slice();
 const attract=boidKick(source,graph);
 assert.ok(attract[4]>source[4],'cohesion pulls left site right');
 assert.ok(attract[12]<source[12],'cohesion pulls right site left');
 assert.equal(attract[4]+attract[12],source[4]+source[12]);
 assert.deepEqual(boidKick(attract,graph,{reverse:true}),source);
 graph.cohesion=0;graph.separation=24;
 const separate=boidKick(source,graph);
 assert.ok(separate[4]<source[4],'separation pushes left site left');
 assert.ok(separate[12]>source[12],'separation pushes right site right');
 assert.equal(separate[4]+separate[12],source[4]+source[12]);
 assert.deepEqual(boidKick(separate,graph,{reverse:true}),source);
 graph.separation=0;graph.steering=12;graph.goalX=40*graph.precision;
 const steered=boidKick(source,graph);
 assert.ok(steered[4]>source[4]&&steered[12]>source[12],
  'external waypoint steers both particles toward +X');
 assert.notEqual(steered[4]+steered[12],source[4]+source[12],
  'an external steering guide exchanges momentum with the environment');
 assert.deepEqual(boidKick(steered,graph,{reverse:true}),source);
});
test('combined boids coefficients preserve exact multi-stage inverse and live editing',async()=>{
 const {seedMovingFlock,evolveFlock}=await import(
  '../src/systems/reversible-springs/flock-cpu.mjs');
 const {createSphereFixture}=await import(
  '../src/systems/reversible-springs/springs-cpu.mjs');
 const f=seedMovingFlock(createSphereFixture({
  side:8,spacing:69,cutoff:117,restLength:69,
  precision:32,stiffness:0,perturbation:0,mode:'dynamic'
 }),{velocity:2,scatter:0.28,pattern:'counterflow',alignment:16,coupling:8});
 Object.assign(f.graph,{cohesion:2,separation:6,steering:2,
  goalX:Math.round(69*7*.4)*32,boundaryExtent:10592});
 const a={...f.graph};
 const first=evolveFlock(f.state,f.hidden,a,16);
 const b={...a,cohesion:6,separation:12,steering:4};
 const second=evolveFlock(first.state,first.hidden,b,9);
 const third=evolveFlock(second.state,second.hidden,b,9,{reverse:true});
 const back=evolveFlock(third.state,third.hidden,a,16,{reverse:true});
 assert.deepEqual(back.state,f.state);
 assert.deepEqual(back.hidden,f.hidden);
 const {SpringCoefficientTimeline}=await import(
  '../src/systems/reversible-springs/springs-timeline.mjs');
 const timeline=new SpringCoefficientTimeline(a);
 timeline.change(16,{cohesion:6,separation:12,steering:4});
 assert.equal(timeline.at(0).cohesion,2);
 assert.equal(timeline.at(16).separation,12);
 timeline.change(8,{steering:0});
 assert.equal(timeline.events.length,2);
 assert.equal(timeline.at(8).steering,0);
 assert.throws(()=>timeline.change(8,{cohesion:65}),/cohesion/);
});
test('half-cell reflecting enclosure returns all visible and hidden bits',async()=>{
 const {seedMovingFlock,stepFlock,evolveFlock}=await import(
  '../src/systems/reversible-springs/flock-cpu.mjs');
 const fixture=seedMovingFlock(createLatticeFixture({
  nx:2,ny:1,nz:1,spacing:8,precision:32,stiffness:0,
  perturbation:0,mode:'dynamic',cutoff:12,restLength:8
 }));
 fixture.graph.boundaryExtent=140;
 fixture.graph.alignment=0;fixture.graph.coupling=0;
 for(let axis=0;axis<3;axis++){
  fixture.state[axis]=138;fixture.state[axis+4]=7*256;
  fixture.state[8+axis]=-138;fixture.state[12+axis]=-7*256;
 }
 const once=stepFlock(fixture.state,fixture.hidden,fixture.graph);
 for(let axis=0;axis<3;axis++){
  assert.equal(once.state[axis],136);
  assert.equal(once.state[axis+4],-7*256);
  assert.equal(once.state[8+axis],-136);
  assert.equal(once.state[12+axis],7*256);
 }
 const undo=stepFlock(once.state,once.hidden,fixture.graph,{reverse:true});
 assert.deepEqual(undo.state,fixture.state);
 assert.deepEqual(undo.hidden,fixture.hidden);
 // Cross many walls in a single step; parity must still rewind.
 for(let axis=0;axis<3;axis++)fixture.state[axis+4]=1024*256;
 const evolved=evolveFlock(fixture.state,fixture.hidden,fixture.graph,128);
 for(let i=0;i<evolved.state.length;i+=8)
  for(let a=0;a<3;a++)assert.ok(Math.abs(evolved.state[i+a])<=140);
 const restored=evolveFlock(evolved.state,evolved.hidden,fixture.graph,128,{reverse:true});
 assert.deepEqual(restored.state,fixture.state);
 assert.deepEqual(restored.hidden,fixture.hidden);
});
test('flocking parameters form a reversible branchable control timeline',async()=>{
 const {createSphereFixture}=await import('../src/systems/reversible-springs/springs-cpu.mjs');
 const {seedMovingFlock,stepFlock}=await import('../src/systems/reversible-springs/flock-cpu.mjs');
 const {SpringCoefficientTimeline}=await import('../src/systems/reversible-springs/springs-timeline.mjs');
 const original=seedMovingFlock(createSphereFixture({side:5,mode:'dynamic',spacing:24,
  cutoff:35,restLength:24,stiffness:1,precision:32,perturbation:0}));
 const timeline=new SpringCoefficientTimeline(original.graph);
 let current={state:original.state,hidden:original.hidden};
 for(let t=0;t<23;t++){
  if(t===6)timeline.change(6,{alignment:12,coupling:10});
  if(t===14)timeline.change(14,{alignment:20,coupling:6,stiffness:3});
  current=stepFlock(current.state,current.hidden,{...original.graph,...timeline.at(t)});
 }
 for(let t=22;t>=0;t--)current=stepFlock(current.state,current.hidden,
  {...original.graph,...timeline.at(t)},{reverse:true});
 assert.deepEqual(current.state,original.state);
 assert.deepEqual(current.hidden,original.hidden);
});

test('straight-line particles retain velocity, invert exactly, and reflect at walls',async()=>{
 const {seedMovingFlock,stepFlock,evolveFlock}=await import(
  '../src/systems/reversible-springs/flock-cpu.mjs');
 const fixture=seedMovingFlock(createLatticeFixture({
  nx:5,ny:4,nz:3,spacing:20,precision:32,stiffness:18,
  mode:'bonded',perturbation:0
 }),{velocity:1.3,scatter:.6});
 Object.assign(fixture.graph,{mode:'straight',stiffness:0,alignment:0,coupling:0});
 const first=stepFlock(fixture.state,fixture.hidden,fixture.graph);
 for(let i=0;i<fixture.graph.count;i++)for(let axis=0;axis<3;axis++){
  const p=i*8+axis;
  assert.ok(first.state[p]-fixture.state[p]===
   Math.trunc(fixture.state[p+4]/256));
  assert.equal(first.state[p+4],fixture.state[p+4]);
 }
 const result=evolveFlock(fixture.state,fixture.hidden,fixture.graph,128);
 const reverse=evolveFlock(result.state,result.hidden,fixture.graph,128,{reverse:true});
 assert.deepEqual(reverse.state,fixture.state);
 assert.deepEqual(reverse.hidden,fixture.hidden);
 fixture.graph.boundaryExtent=1800;
 const walled=evolveFlock(fixture.state,fixture.hidden,fixture.graph,320);
 for(let i=0;i<fixture.graph.count;i++)for(let axis=0;axis<3;axis++)
  assert.ok(Math.abs(walled.state[i*8+axis])<=1800);
 const restored=evolveFlock(walled.state,walled.hidden,fixture.graph,320,{reverse:true});
 assert.deepEqual(restored.state,fixture.state);
 assert.deepEqual(restored.hidden,fixture.hidden);
});
test('downsampled reference lattice is static and contains exact fixture sites',async()=>{
 const {referenceLatticeSegments}=await import(
  '../src/systems/reversible-springs/springs-cpu.mjs');
 const cfg={nx:12,ny:12,nz:6,spacing:44,precision:32};
 const medium=referenceLatticeSegments(cfg,6);
 const fine=referenceLatticeSegments(cfg,8);
 assert.equal(medium.siteCount,216);
 assert.equal(medium.edgeCount,540);
 assert.equal(medium.vertices.length,540*8);
 assert.ok(fine.edgeCount>medium.edgeCount);
 const fixture=createLatticeFixture({nx:12,ny:12,nz:6,spacing:44,precision:32,perturbation:0});
 const coords=new Set();
 for(let i=0;i<fixture.graph.count;i++)
  coords.add(fixture.state.slice(8*i,8*i+3).join(','));
 for(let i=0;i<medium.vertices.length;i+=4)
  assert.ok(coords.has(Array.from(medium.vertices.slice(i,i+3)).join(',')));
 assert.deepEqual(medium.vertices,referenceLatticeSegments(cfg,6).vertices);
 assert.throws(()=>referenceLatticeSegments(cfg,9),/density/);
});

test('H4 downprojected lattice uses exact antipodal root pairs and distinct display projections',async()=>{
 const {H4_ROOT_DELTAS,GOLDEN_RATIO,projectH4CoefficientSite,
  generateProjectedH4Lattice}=await import(
  '../src/systems/reversible-springs/downprojected-h4-lattice.mjs');
 assert.equal(H4_ROOT_DELTAS.length,120);
 for(let i=0;i<120;i+=2)
  assert.ok(H4_ROOT_DELTAS[i].every((x,j)=>x===-H4_ROOT_DELTAS[i+1][j]));
 assert.deepEqual(projectH4CoefficientSite([0,0,2,0,0,0,0,0]),
  [1,0,0]);
 assert.ok(Math.abs(projectH4CoefficientSite([0,0,0,1,0,0,0,0])[0]-
  GOLDEN_RATIO/2)<1e-12);
 for(const radius of [2,3,4]){
  for(const projection of ['orthographic','hopf']){
   const lattice=generateProjectedH4Lattice({radius,projection,worldScale:512});
   assert.equal(lattice.rootAlphabet,120);
   assert.ok(lattice.siteCount>0&&lattice.edgeCount>0);
   assert.ok(lattice.edgeCount<=lattice.rootEdges);
   assert.equal(lattice.vertices.length,lattice.edgeCount*8);
   assert.ok(lattice.vertices.every(Number.isFinite));
   assert.deepEqual(lattice.vertices,
    generateProjectedH4Lattice({radius,projection,worldScale:512}).vertices);
  }
 }
 const visible=generateProjectedH4Lattice({radius:2,projection:'orthographic'});
 assert.equal(visible.siteCount,145);
 assert.equal(visible.edgeCount,231);
 assert.throws(()=>generateProjectedH4Lattice({radius:5}),/radius/);
});

test('canonical E8 -> H3 golden projection has six Cycles axes and 137-site fibers',async()=>{
 const {PHI,VISIBLE,H3_COLUMNS,projectE8H3,e8RootShell,
  generateProjectedE8H3Lattice}=await import(
   '../src/systems/reversible-springs/downprojected-e8-h3-lattice.mjs');
 assert.deepEqual(VISIBLE,[1,2,3,5,6,7]);
 const factor=Math.sqrt(2*(1+PHI*PHI));
 const axes=[[1,PHI,0],[PHI,0,1],[0,1,PHI],
             [-1,PHI,0],[PHI,0,-1],[0,-1,PHI]];
 for(let i=0;i<6;i++){
  const basis=Array(8).fill(0);basis[VISIBLE[i]]=2;
  const projected=projectE8H3(basis);
  for(let k=0;k<3;k++){
   assert.ok(Math.abs(projected[k]-axes[i][k]/factor)<1e-12);
   assert.ok(Math.abs(projected[k]-H3_COLUMNS[i][k])<1e-12);
  }
 }
 for(const hidden of [0,4]){
  const basis=Array(8).fill(0);basis[hidden]=2;
  assert.ok(projectE8H3(basis).every(v=>Math.abs(v)<1e-12));
 }
 for(let i=0;i<3;i++)for(let j=0;j<3;j++){
  const dot=H3_COLUMNS.reduce((sum,column)=>sum+column[i]*column[j],0);
  assert.ok(Math.abs(dot-(i===j?1:0))<1e-12);
 }
 const roots=e8RootShell();
 assert.equal(roots.length,240);
 const secondMoment=roots.reduce((sum,r)=>
  sum+projectE8H3(r).reduce((total,x)=>total+x*x,0),0);
 assert.ok(Math.abs(secondMoment-180)<1e-9);
 const q6=generateProjectedE8H3Lattice({kind:'q6'});
 assert.equal(q6.siteCount,64);
 assert.equal(q6.edgeCount,192);
 for(let i=0;i<q6.vertices.length;i+=8){
  const v=q6.vertices;
  const r2=(v[i]-v[i+4])**2+(v[i+1]-v[i+5])**2+(v[i+2]-v[i+6])**2;
  assert.ok(Math.abs(r2-.5)<1e-6);
 }
 const shell=generateProjectedE8H3Lattice({kind:'shell'});
 assert.equal(shell.sourceRootCount,240);
 assert.equal(shell.distinctProjectedSites,137);
 assert.deepEqual(shell.fibers,{'1':60,'2':64,'4':13});
 assert.equal(shell.rawEdges,6720);
 assert.equal(shell.collapsed,112);
 assert.equal(shell.edgeCount,2752);
 assert.deepEqual(shell.vertices,
  generateProjectedE8H3Lattice({kind:'shell'}).vertices);
});
