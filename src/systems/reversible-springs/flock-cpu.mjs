import {stage as springStage,momentum} from './springs-cpu.mjs';

/** Reversible, momentum-conserving local velocity coupling.
 * Auxiliary h_i (signed int32 XYZ) stores the phase information which
 * ordinary dissipative boids alignment would discard. Unlike damping,
 * the two antisymmetric pair shears form an exact permutation.
 */
export function seedMovingFlock(fixture,{
 velocity=1,scatter=0.35,pattern='drift',alignment=16,coupling=8
}={}){
 if(!Number.isFinite(velocity)||velocity<0||velocity>16||
    !Number.isFinite(scatter)||scatter<0||scatter>4||
    !['drift','counterflow'].includes(pattern)||
    !Number.isInteger(alignment)||alignment<0||alignment>64||
    !Number.isInteger(coupling)||coupling<0||coupling>64)
  throw Error('Invalid reversible flock seed');
 const {state,graph}=fixture;
 const out=state.slice(),hidden=new Int32Array(graph.count*4);
 const unit=graph.precision*256;
 for(let i=0;i<graph.count;i++){
  const p=i*8;
  const jitter=(axis)=>(((i*37+axis*71+((i+axis)*17)%31)%101)-50)/50;
  // Two opposed local streams make velocity exchange observable without
  // introducing dissipative forces or changing the exact inverse.
  const heading=pattern==='counterflow'?(state[p]<0?1:-1):1;
  out[p+4]=Math.trunc((heading*velocity+scatter*jitter(0))*unit);
  out[p+5]=Math.trunc((heading*velocity*(pattern==='counterflow'?.12:.3)+
   scatter*jitter(1))*unit);
  out[p+6]=Math.trunc(((pattern==='counterflow'?0:velocity*.1)+
   scatter*jitter(2))*unit);
 }
 return {state:out,hidden,graph:{...graph,mode:'flock',alignment,coupling,cohesion:graph.cohesion??0,separation:graph.separation??0,steering:graph.steering??0}};
}
export function flockPairs(state,graph){
 const ids=[],c2=graph.cutoff*graph.cutoff,q=graph.precision;
 for(let i=0;i<graph.count;i++)for(let j=i+1;j<graph.count;j++){
  const a=i*8,b=j*8;
  const dx=Math.trunc((state[b]-state[a])/q);
  const dy=Math.trunc((state[b+1]-state[a+1])/q);
  const dz=Math.trunc((state[b+2]-state[a+2])/q);
  if(dx*dx+dy*dy+dz*dz<=c2)ids.push(i,j);
 }
 return ids;
}
function shear(state,hidden,graph,kind,sign){
 const p=state.slice(),h=hidden.slice(),pairs=flockPairs(state,graph);
 const dv=new Int32Array(graph.count*3);
 const strength=kind==='hidden'?graph.alignment:graph.coupling;
 for(let e=0;e<pairs.length;e+=2){
  const i=pairs[e],j=pairs[e+1];
  for(let axis=0;axis<3;axis++){
   const ai=kind==='hidden'?state[i*8+4+axis]:hidden[i*4+axis];
   const bj=kind==='hidden'?state[j*8+4+axis]:hidden[j*4+axis];
   const diff=Math.trunc((bj-ai)*strength/256);
   const val=kind==='hidden'?diff:-diff;
   dv[i*3+axis]+=val;dv[j*3+axis]-=val;
  }
 }
 for(let i=0;i<graph.count;i++)for(let axis=0;axis<3;axis++){
  if(kind==='hidden')h[i*4+axis]+=sign*dv[i*3+axis];
  else p[i*8+4+axis]+=sign*dv[i*3+axis];
 }
 return {state:p,hidden:h};
}
// Position-only kick for three additional reversible boid behaviors.
// Pair-wise cohesion draws neighbors together, short-range separation pushes
// overlapping neighbors apart, and goal steering guides each particle toward
// the fixed +X waypoint. The first two conserve particle momentum; external
// steering need not. Because positions are unchanged during this stage, the
// exact inverse simply subtracts the same integer force at the same positions.
export function boidKick(state,graph,{reverse=false}={}){
 const out=state.slice();
 const cohesion=graph.cohesion??0,separation=graph.separation??0,
  steering=graph.steering??0;
 if(!(cohesion||separation||steering))return out;
 const delta=new Int32Array(graph.count*3),inner=Math.trunc(graph.cutoff*2/3);
 const r2=inner*inner,q=graph.precision,pairs=flockPairs(state,graph);
 for(let n=0;n<pairs.length;n+=2){
  const i=pairs[n],j=pairs[n+1];
  const a=i*8,b=j*8;
  const dx=Math.trunc((state[b]-state[a])/q);
  const dy=Math.trunc((state[b+1]-state[a+1])/q);
  const dz=Math.trunc((state[b+2]-state[a+2])/q);
  const near=dx*dx+dy*dy+dz*dz<=r2;
  for(let axis=0;axis<3;axis++){
   const d=state[b+axis]-state[a+axis];
   const f=Math.trunc(d*cohesion/256)-
    (near?Math.trunc(d*separation/256):0);
   delta[i*3+axis]+=f;delta[j*3+axis]-=f;
  }
 }
 for(let i=0;i<graph.count;i++)for(let axis=0;axis<3;axis++){
  const p=i*8+axis,guide=axis===0?(graph.goalX??0):0;
  const steer=Math.trunc((guide-state[p])*steering/256);
  out[p+4]+=(reverse?-1:1)*(delta[i*3+axis]+steer);
 }
 return out;
}
// Reflecting planes sit half a lattice unit beyond each integer limit.
// This avoids exact-wall ambiguity and preserves bit-exact inverse drift.
export function reflectiveDrift(state,graph,{reverse=false}={}){
 const bound=graph.boundaryExtent??0;
 if(!bound)return springStage(state,graph,reverse?'undrift':'drift');
 if(!Number.isSafeInteger(bound)||bound<1||bound>1000000)
  throw Error('Invalid reflective boundary extent');
 const out=state.slice(),direction=reverse?-1:1;
 for(let i=0;i<graph.count;i++)for(let axis=0;axis<3;axis++){
  const xIndex=i*8+axis,pIndex=xIndex+4;
  let p=out[pIndex],x=out[xIndex]+direction*Math.trunc(p/256);
  while(x>bound||x< -bound){
   x=x>bound?2*bound+1-x:-2*bound-1-x;
   p=-p;
  }
  out[xIndex]=x;out[pIndex]=p;
 }
 return out;
}
export function stepFlock(state,hidden,graph,{reverse=false}={}){
 if(graph.mode==='straight')return {state:reflectiveDrift(state,graph,{reverse}),hidden:hidden.slice()};
 if(reverse){
  const drift=reflectiveDrift(state,graph,{reverse:true});
  const spring=springStage(drift,graph,'unkick');
  const navigated=boidKick(spring,graph,{reverse:true});
  const visible=shear(navigated,hidden,graph,'visible',-1);
  return shear(visible.state,visible.hidden,graph,'hidden',-1);
 }
 const phase=shear(state,hidden,graph,'hidden',1);
 const visible=shear(phase.state,phase.hidden,graph,'visible',1);
 const navigated=boidKick(visible.state,graph);
 const kicked=springStage(navigated,graph,'kick');
 return {state:reflectiveDrift(kicked,graph),hidden:visible.hidden};
}
export function evolveFlock(state,hidden,graph,ticks,{reverse=false}={}){
 let s=state.slice(),h=hidden.slice();
 for(let t=0;t<ticks;t++){
  const next=stepFlock(s,h,graph,{reverse});
  s=next.state;h=next.hidden;
 }
 return {state:s,hidden:h};
}
export function flockStats(state,hidden,graph){
 const p=momentum(state),count=graph.count,avg=p.map(v=>v/count);
 let variance=0;
 for(let i=0;i<count;i++)for(let axis=0;axis<3;axis++){
  const d=state[i*8+4+axis]-avg[axis];variance+=d*d;
 }
 const hiddenTotals=[0,0,0];
 for(let i=0;i<count;i++)for(let axis=0;axis<3;axis++)
  hiddenTotals[axis]+=hidden[i*4+axis];
 return {momentum:p,hiddenTotals,velocityVariance:variance/count,
  pairCount:flockPairs(state,graph).length/2};
}
