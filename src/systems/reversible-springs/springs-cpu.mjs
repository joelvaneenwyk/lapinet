/** Isolated reversible integer spring reference for Lapinet.
 * Particle = [x,y,z,0, px,py,pz,0], Int32Array (32 bytes).
 * Static directed CSR has equal/opposite rest deltas and identical stiffness.
 * The kick/drift triangular maps are exact inverses; the system does not
 * require float state, nondeterministic atomics, or solver iteration.
 */
export const PARTICLE_STRIDE=8;
export const SPRING_DENOM=256;
export const DRIFT_DENOM=256;
// The public demo's cube must sample equal coordinate extents on all axes.
// Keep its physical resolution independent of the optional wireframe density.
export function cubicGridDimensions(side){
 if(!Number.isInteger(side)||side<2||side>24)
  throw Error('Demo cube side must be an integer in 2..24');
 return {nx:side,ny:side,nz:side};
}
const ix=(i)=>i*PARTICLE_STRIDE;
const trunc=Math.trunc;
export function createLatticeFixture({
 nx=6,ny=6,nz=3,spacing=96,stiffness=18,perturbation=14,
 precision=16,mode='bonded',cutoff=132,restLength=96,restScale256=256
}={}){
 for(const n of [nx,ny,nz,spacing,stiffness,perturbation])if(!Number.isInteger(n)||n<0)throw Error('Invalid spring fixture integer');
 if(nx<2||ny<1||nz<1||nx*ny*nz>16384||stiffness>64||spacing<8||
 ![8,16,32,64].includes(precision)||!['bonded','dynamic'].includes(mode)||
 (mode==='dynamic'&&nx*ny*nz>512))throw Error('Out of range spring fixture');
 const count=nx*ny*nz,state=new Int32Array(count*8),neighbors=Array.from({length:count},()=>[]);
 const id=(x,y,z)=>(z*ny+y)*nx+x;
 for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const i=id(x,y,z),p=ix(i),s=spacing*precision;
  state[p]=Math.trunc(s*(2*x-(nx-1))/2);
  state[p+1]=Math.trunc(s*(2*y-(ny-1))/2);
  state[p+2]=Math.trunc(s*(2*z-(nz-1))/2);
  for(const [xx,yy,zz] of [[x+1,y,z],[x,y+1,z],[x,y,z+1]]){
   if(xx>=nx||yy>=ny||zz>=nz)continue;
   const j=id(xx,yy,zz),rest=[(xx-x)*s,(yy-y)*s,(zz-z)*s];
   neighbors[i].push({j,rest});
   neighbors[j].push({j:i,rest:rest.map(v=>-v)});
  }
 }
 // Balanced initial deformation, with zero initial momentum.
 for(let i=0;i<count;i++){
  const x=i%nx,y=Math.floor(i/nx)%ny,z=Math.floor(i/(nx*ny));
  const p=ix(i);
  state[p]+=perturbation*precision*((x+y+z)&1?1:-1);
  state[p+1]+=perturbation*precision*((y+z)&1?-1:1);
  state[p+2]+=perturbation*precision*((x+z)&1?1:-1);
 }
 const offsets=new Uint32Array(count+1),edges=[];
 for(let i=0;i<count;i++){
  neighbors[i].sort((a,b)=>a.j-b.j);
  for(const n of neighbors[i])edges.push(n);
  offsets[i+1]=edges.length;
 }
 const indices=new Uint32Array(edges.length);
 const rests=new Int32Array(edges.length*4);
 edges.forEach(({j,rest},e)=>{indices[e]=j;rests.set([...rest,stiffness],e*4)});
 const graph={count,offsets,indices,rests,precision,mode,cutoff,restLength,stiffness,spacing,restScale256};
 validateGraph(graph);
 return {graph,state};
}
export function createSphereFixture({side=7,spacing=80,stiffness=18,perturbation=12,
 precision=16,mode='dynamic',cutoff=114,restLength=80,restScale256=256}={}){
 if(!Number.isInteger(side)||side<3||side>24)
  throw Error('Invalid sphere side');
 const base=createLatticeFixture({nx:side,ny:side,nz:side,spacing,stiffness,
  perturbation,precision,mode:'bonded',cutoff,restLength,restScale256});
 const keep=[],map=new Map(),radius=(side-1)*spacing/2+0.001;
 for(let z=0;z<side;z++)for(let y=0;y<side;y++)for(let x=0;x<side;x++){
  const dx=(x-(side-1)/2)*spacing,dy=(y-(side-1)/2)*spacing,dz=(z-(side-1)/2)*spacing;
  if(dx*dx+dy*dy+dz*dz>radius*radius)continue;
  const old=(z*side+y)*side+x;map.set(old,keep.length);keep.push(old);
 }
 if(mode==='dynamic'&&keep.length>512)
  throw Error('Dynamic sphere limited to 512 particles');
 const count=keep.length,state=new Int32Array(count*8),
  offsets=new Uint32Array(count+1),indices=[],rest=[];
 for(let i=0;i<count;i++){
  const old=keep[i];state.set(base.state.subarray(old*8,old*8+8),i*8);
  for(let e=base.graph.offsets[old];e<base.graph.offsets[old+1];e++){
   const j=map.get(base.graph.indices[e]);
   if(j===undefined)continue;
   indices.push(j);rest.push(...base.graph.rests.subarray(e*4,e*4+4));
  }
  offsets[i+1]=indices.length;
 }
 const graph={count,offsets,indices:new Uint32Array(indices),rests:new Int32Array(rest),
  mode,precision,cutoff,restLength,stiffness,spacing,restScale256};
 validateGraph(graph);return {graph,state};
}

export function validateGraph({count,offsets,indices,rests}){
 if(!Number.isInteger(count)||count<1||offsets.length!==count+1||offsets[0]!==0||offsets.at(-1)!==indices.length||rests.length!==indices.length*4)throw Error('Invalid spring CSR');
 const reverse=new Map();
 for(let i=0;i<count;i++)for(let e=offsets[i];e<offsets[i+1];e++){
  const j=indices[e];if(j>=count||j===i||e>0xffffffff)throw Error('Invalid spring edge');
  const v=Array.from(rests.subarray(e*4,e*4+4));
  if(v[3]<0||v[3]>256)throw Error('Invalid spring stiffness');
  const key=i+':'+j;if(reverse.has(key))throw Error('Duplicate directed spring');
  reverse.set(key,v);
 }
 for(const [key,[x,y,z,k]] of reverse){
  const [i,j]=key.split(':');
  const back=reverse.get(j+':'+i);
  if(!back||back[0]!==-x||back[1]!==-y||back[2]!==-z||back[3]!==k)
   throw Error('Missing/unequal opposite spring '+key);
 }
 return true;
}
// A scalar times the ACTUAL integer displacement guarantees exact
// equal/opposite pair force and zero instantaneous pair torque.
export function centralScalar(dx,dy,dz,rest2,stiffness,precision){
 const x=Math.trunc(dx/precision),y=Math.trunc(dy/precision),z=Math.trunc(dz/precision);
 const r2=x*x+y*y+z*z;
 return Math.max(-3,Math.min(3,Math.trunc(((r2-rest2)*stiffness)/Math.max(1,4*rest2))));
}
export function scaledRestSquared(baseRestSquared,restScale256=256){
 if(!Number.isInteger(restScale256)||restScale256<64||restScale256>512)
  throw Error('Rest scale must be an integer in [64,512]');
 return Math.trunc(Math.trunc(baseRestSquared*restScale256/256)*restScale256/256);
}
export function forces(state,graph){
 const {count,offsets,indices,rests,mode='bonded',precision=16,cutoff=132,restLength=96,stiffness=18,restScale256=256}=graph;
 if(state.length!==count*8)throw Error('Spring state size differs from graph');
 const out=new Int32Array(count*3),cutoff2=cutoff*cutoff,rest2=scaledRestSquared(restLength*restLength,restScale256);
 for(let i=0;i<count;i++){
  const p=ix(i),f=3*i;
  if(mode==='dynamic'||mode==='flock'){
   for(let j=0;j<count;j++){
    if(i===j)continue;
    const q=ix(j),dx=state[q]-state[p],dy=state[q+1]-state[p+1],dz=state[q+2]-state[p+2];
    const x=Math.trunc(dx/precision),y=Math.trunc(dy/precision),z=Math.trunc(dz/precision);
    if(Math.abs(x)>cutoff||Math.abs(y)>cutoff||Math.abs(z)>cutoff||x*x+y*y+z*z>cutoff2)continue;
    const m=centralScalar(dx,dy,dz,rest2,stiffness,precision);
    out[f]+=m*dx;out[f+1]+=m*dy;out[f+2]+=m*dz;
   }
  }else for(let e=offsets[i];e<offsets[i+1];e++){
   const q=ix(indices[e]),b=e*4,dx=state[q]-state[p],dy=state[q+1]-state[p+1],dz=state[q+2]-state[p+2];
   const rx=Math.trunc(rests[b]/precision),ry=Math.trunc(rests[b+1]/precision),rz=Math.trunc(rests[b+2]/precision);
   const m=centralScalar(dx,dy,dz,scaledRestSquared(rx*rx+ry*ry+rz*rz,restScale256),stiffness,precision);
   out[f]+=m*dx;out[f+1]+=m*dy;out[f+2]+=m*dz;
  }
 }
 return out;
}
// Reference 3D site lattice, never the higher-dimensional transport lattice.
export function referenceLatticeSegments({nx,ny,nz,spacing,precision},density=6){
 if(!Number.isSafeInteger(density)||density<2||density>8)
  throw Error('Invalid reference-lattice density');
 const dims=[nx,ny,nz];
 if(dims.some(x=>!Number.isSafeInteger(x)||x<1)||
    !Number.isSafeInteger(spacing)||spacing<1||
    !Number.isSafeInteger(precision)||precision<1)
  throw Error('Invalid lattice dimensions');
 const axes=dims.map(n=>{
  let count=Math.min(n,density);
  return count===1?[0]:Array.from({length:count},(_,i)=>
   Math.round(i*(n-1)/(count-1)));
 });
 const coordinate=(i,axis)=>Math.trunc(spacing*precision*
  (2*i-(dims[axis]-1))/2);
 const vertices=[];
 for(let z=0;z<axes[2].length;z++)
 for(let y=0;y<axes[1].length;y++)
 for(let x=0;x<axes[0].length;x++){
  const idx=[x,y,z];
  const a=idx.map((v,axis)=>coordinate(axes[axis][v],axis));
  for(let axis=0;axis<3;axis++){
   if(idx[axis]+1>=axes[axis].length)continue;
   const b=a.slice();
   b[axis]=coordinate(axes[axis][idx[axis]+1],axis);
   vertices.push(...a,1,...b,1);
  }
 }
 return {vertices:new Float32Array(vertices),edgeCount:vertices.length/8,
  siteCount:axes.reduce((m,a)=>m*a.length,1),sampledAxes:axes.map(a=>a.length)};
}
export function springPairs(graph){
 const ids=[];
 for(let i=0;i<graph.count;i++)
  for(let e=graph.offsets[i];e<graph.offsets[i+1];e++)
   if(i<graph.indices[e])ids.push(i,graph.indices[e]);
 return new Uint32Array(ids);
}
export function dynamicPairs(count){
 if(count>512)throw Error('Dynamic neighborhood must be <=512 particles');
 const pairs=new Uint32Array(count*(count-1));
 let k=0;for(let i=0;i<count;i++)for(let j=i+1;j<count;j++){pairs[k++]=i;pairs[k++]=j;}
 return pairs;
}
export function contactCount(state,graph){
 const cutoff2=graph.cutoff*graph.cutoff;let n=0;
 for(let i=0;i<graph.count;i++)for(let j=i+1;j<graph.count;j++){
  const a=i*8,b=j*8,q=graph.precision;
  const dx=Math.trunc((state[b]-state[a])/q),dy=Math.trunc((state[b+1]-state[a+1])/q),dz=Math.trunc((state[b+2]-state[a+2])/q);
  if(dx*dx+dy*dy+dz*dz<=cutoff2)n++;
 }
 return n;
}
export function angularMomentum(state){
 const L=[0n,0n,0n];
 for(let i=0;i<state.length;i+=8){
  const [x,y,z]=[BigInt(state[i]),BigInt(state[i+1]),BigInt(state[i+2])];
  const [px,py,pz]=[BigInt(state[i+4]),BigInt(state[i+5]),BigInt(state[i+6])];
  L[0]+=y*pz-z*py;L[1]+=z*px-x*pz;L[2]+=x*py-y*px;
 }
 return L.map(String);
}
export function stage(state,graph,operation){
 const out=state.slice(),count=graph.count;
 if(operation==='kick'||operation==='unkick'){
  const f=forces(state,graph),sgn=operation==='kick'?1:-1;
  for(let i=0;i<count;i++)for(let k=0;k<3;k++)out[ix(i)+4+k]+=sgn*f[i*3+k];
 }else if(operation==='drift'||operation==='undrift'){
  const sgn=operation==='drift'?1:-1;
  for(let i=0;i<count;i++)for(let k=0;k<3;k++)out[ix(i)+k]+=sgn*Math.trunc(out[ix(i)+4+k]/DRIFT_DENOM);
 }else throw Error('Unknown spring stage: '+operation);
 return out;
}
export function step(state,graph,{reverse=false}={}){
 const a=stage(state,graph,reverse?'undrift':'kick');
 return stage(a,graph,reverse?'unkick':'drift');
}
export function evolve(state,graph,ticks,{reverse=false}={}){
 let s=state.slice();
 for(let i=0;i<ticks;i++)s=step(s,graph,{reverse});
 return s;
}
export function momentum(state){
 const p=[0,0,0];
 for(let i=0;i<state.length;i+=8)for(let j=0;j<3;j++)p[j]+=state[i+4+j];
 return p;
}
export function checksum(state){let h=0x811c9dc5;for(const x of state)h=Math.imul(h^(x>>>0),0x01000193);return h>>>0}
