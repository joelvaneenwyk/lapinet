import {createSphereFixture,createLatticeFixture} from './springs-cpu.mjs';
import {seedMovingFlock,flockStats,evolveFlock} from './flock-cpu.mjs';
import {ReversibleFlockGPU} from './flock-gpu.js';

const adapter=await navigator.gpu.requestAdapter();
if(!adapter)throw Error('No Apple WebGPU adapter');
const device=await adapter.requestDevice();
for(const side of [5,7,8]){
 const fixture=seedMovingFlock(createSphereFixture({
  side,spacing:24,cutoff:35,restLength:24,stiffness:0,
  precision:32,perturbation:0,mode:'dynamic',
 }));
 const solver=await ReversibleFlockGPU.create({
  device,fixture,
  fetchImpl:async()=>({ok:true,text:async()=>
   await Deno.readTextFile(new URL('./flock.wgsl',import.meta.url))})
 });
 const before=await solver.read(),hBefore=await solver.readHidden();
 const initial=flockStats(before,hBefore,fixture.graph);
 const certificate=await solver.certify({roundtrip:12});
 if(!certificate.passed)throw Error('GPU/CPU flock parity '+JSON.stringify(certificate));
 solver.step(8);
 const mid=flockStats(await solver.read(),await solver.readHidden(),fixture.graph);
 solver.setCoefficients({alignment:12,coupling:10});
 solver.step(5);
 solver.setCoefficients({alignment:20,coupling:6});
 solver.step(5);
 const final=await solver.read(),hFinal=await solver.readHidden();
 const later=flockStats(final,hFinal,fixture.graph);
 solver.step(18,{reverse:true});
 const restored=await solver.read(),hRestored=await solver.readHidden();
 const reverse=restored.reduce((n,x,i)=>n+(x!==before[i]),0)+
  hRestored.reduce((n,x,i)=>n+(x!==hBefore[i]),0);
 solver.step(18);
 const replay=await solver.read(),rh=await solver.readHidden();
 const replayErrors=replay.reduce((n,x,i)=>n+(x!==final[i]),0)+
  rh.reduce((n,x,i)=>n+(x!==hFinal[i]),0);
 const stats={particles:fixture.graph.count,side,certificate,
  initialVariance:initial.velocityVariance,varianceAfter8:mid.velocityVariance,
  normalizedVariance:mid.velocityVariance/initial.velocityVariance,
  conservedMomentum:initial.momentum.every((x,i)=>x===later.momentum[i]),
  inverseMismatches:reverse,replayMismatches:replayErrors,
  pairCount:initial.pairCount};
 console.log(JSON.stringify(stats));
 if(reverse||replayErrors||!stats.conservedMomentum)throw Error('Flock reverse failed');
 solver.destroy();
}
// Wall-collision certificate: multiple crossings per tick, all six planes.
const bounded=seedMovingFlock(createLatticeFixture({
 nx:2,ny:1,nz:1,spacing:8,precision:32,stiffness:0,
 perturbation:0,mode:'dynamic',cutoff:12,restLength:8
}));
bounded.graph.boundaryExtent=140;
bounded.graph.alignment=0;bounded.graph.coupling=0;
for(let axis=0;axis<3;axis++){
 bounded.state[axis]=138;bounded.state[axis+4]=1024*256;
 bounded.state[8+axis]=-138;bounded.state[12+axis]=-7*256;
}
const enclosed=await ReversibleFlockGPU.create({
 device,fixture:bounded,
 fetchImpl:async()=>({ok:true,text:async()=>
  await Deno.readTextFile(new URL('./flock.wgsl',import.meta.url))})
});
const wallCertificate=await enclosed.certify({roundtrip:128});
if(!wallCertificate.passed)throw Error('Reflective GPU parity '+JSON.stringify(wallCertificate));
const enclosedState=await enclosed.read();
for(let i=0;i<enclosedState.length;i+=8)
 for(let axis=0;axis<3;axis++)
  if(Math.abs(enclosedState[i+axis])>140)throw Error('Particle escaped');
console.log(JSON.stringify({reflectiveEnclosure:wallCertificate}));
enclosed.destroy();
for(const enclosedMode of [false,true]){
 const straight=seedMovingFlock(createSphereFixture({
  side:7,spacing:24,cutoff:35,restLength:24,stiffness:0,
  precision:32,perturbation:0,mode:'bonded'
 }),{velocity:1.3,scatter:0.6});
 Object.assign(straight.graph,{mode:'straight',stiffness:0,alignment:0,coupling:0});
 if(enclosedMode)straight.graph.boundaryExtent=2400;
 const ballistic=await ReversibleFlockGPU.create({
  device,fixture:straight,
  fetchImpl:async()=>({ok:true,text:async()=>
   await Deno.readTextFile(new URL('./flock.wgsl',import.meta.url))})
 });
 const certificate=await ballistic.certify({roundtrip:64});
 if(!certificate.passed)throw Error('Straight-line GPU mismatch: '+JSON.stringify(certificate));
 console.log(JSON.stringify({mode:'straight',reflecting:enclosedMode,certificate}));
 ballistic.destroy();
}
// Demonstrate visible coherence and exact GPU/CPU rewind for the same preset
// exposed by the Flock demo button, without GPU readback during playback.
const counterflow=seedMovingFlock(createSphereFixture({
 side:8,spacing:69,cutoff:117,restLength:69,stiffness:0,
 precision:32,perturbation:0,mode:'dynamic'
}),{velocity:2,scatter:0.28,pattern:'counterflow',alignment:16,coupling:8});
counterflow.graph.boundaryExtent=10592;
const demo=await ReversibleFlockGPU.create({
 device,fixture:counterflow,
 fetchImpl:async()=>({ok:true,text:async()=>
  await Deno.readTextFile(new URL('./flock.wgsl',import.meta.url))})
});
const demoCertificate=await demo.certify({roundtrip:60});
if(!demoCertificate.passed)
 throw Error('Counterflow GPU exact inverse failed '+JSON.stringify(demoCertificate));
const beforeStats=flockStats(counterflow.state,counterflow.hidden,counterflow.graph);
demo.step(60);
const afterStats=flockStats(await demo.read(),await demo.readHidden(),counterflow.graph);
const varianceRatio=afterStats.velocityVariance/beforeStats.velocityVariance;
if(!(varianceRatio<0.25))
 throw Error('Counterflow heading alignment did not become visible: '+varianceRatio);
console.log(JSON.stringify({demo:'counterflow',particles:counterflow.graph.count,
  initialPairs:beforeStats.pairCount,varianceRatio,
  gpuCpuMismatches:demoCertificate.cpuMismatches,
  inverseMismatches:demoCertificate.inverseMismatches}));
demo.destroy();
// Exact CPU/GPU parity of the complete reversible boids stage, including
// cohesion, separation, goal steering, reflective walls, and coefficient
// events edited during playback.
const boids=seedMovingFlock(createSphereFixture({
 side:8,spacing:69,cutoff:117,restLength:69,stiffness:0,
 precision:32,perturbation:0,mode:'dynamic'
}),{velocity:2,scatter:0.28,pattern:'counterflow',alignment:16,coupling:8});
Object.assign(boids.graph,{
 cohesion:2,separation:6,steering:2,goalX:Math.round(69*7*.4)*32,
 boundaryExtent:10592
});
const guide=await ReversibleFlockGPU.create({
 device,fixture:boids,
 fetchImpl:async()=>({ok:true,text:async()=>
  await Deno.readTextFile(new URL('./flock.wgsl',import.meta.url))})
});
const combinedCert=await guide.certify({roundtrip:32});
if(!combinedCert.passed)throw Error('Combined boids GPU mismatch '+JSON.stringify(combinedCert));
const g0={...boids.graph},beforeState=await guide.read(),beforeHidden=await guide.readHidden();
guide.step(12);
const patch1={cohesion:6,separation:12,steering:4};
guide.setCoefficients(patch1);
guide.step(9);
const patch2={cohesion:1,separation:4,steering:0};
guide.setCoefficients(patch2);
guide.step(9);
const reached=await guide.read(),hiddenReached=await guide.readHidden();
const a=evolveFlock(beforeState,beforeHidden,g0,12);
const b=evolveFlock(a.state,a.hidden,{...g0,...patch1},9);
const c=evolveFlock(b.state,b.hidden,{...g0,...patch1,...patch2},9);
const mismatch=reached.reduce((n,x,i)=>n+(x!==c.state[i]),0)+
 hiddenReached.reduce((n,x,i)=>n+(x!==c.hidden[i]),0);
guide.step(30,{reverse:true});
const restored=await guide.read(),hRestored=await guide.readHidden();
const inverse=restored.reduce((n,x,i)=>n+(x!==beforeState[i]),0)+
 hRestored.reduce((n,x,i)=>n+(x!==beforeHidden[i]),0);
guide.step(30);
const repeated=await guide.read(),hRepeated=await guide.readHidden();
const replay=repeated.reduce((n,x,i)=>n+(x!==reached[i]),0)+
 hRepeated.reduce((n,x,i)=>n+(x!==hiddenReached[i]),0);
console.log(JSON.stringify({mode:'reversible-boids',particles:boids.graph.count,
 certificate:combinedCert,cohesion:2,separation:6,steering:2,
 liveEdits:[patch1,patch2],cpuGpuMismatches:mismatch,
 inverseMismatches:inverse,replayMismatches:replay}));
if(mismatch||inverse||replay)throw Error('Live boids coefficient parity/inverse failed');
guide.destroy();
device.destroy();console.log('PASS 8/8 reversible GPU flock/boids/ballistic tests');
