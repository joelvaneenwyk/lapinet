/**
 * Exact icosian/E8 rank-eight lattice built from the binary icosahedral
 * quaternion roots in the golden integer ring.
 *
 * Quaternion coordinates are (a+b*phi)/2; the eight integer numerators
 * z=(a0,b0,...,a3,b3) obey the extended Hamming [8,4,4] parity code.
 * The squared E8 norm is Q(z)=sum(z_i^2)/2 = 2*constantTerm(N(q)).
 * A systematic integer basis B of index 16 maps unrestricted k in Z^8
 * to *valid* icosians z=Bk. Store k, not z, as eight 12-bit fields.
 *
 * Physical H4 reflections act as integer unimodular matrices on k.
 * Their exact symmetry is retained on (Z/4096 Z)^8.
 */
import {exactRootPairs} from './baseline/noether024-sandbox/src/noether-h4-exact.js';

export const E8_BITS=12, E8_SIDE=4096, E8_MASK=4095;
export const E8_CHANNELS=240, E8_H4_CHANNELS=120;
export const E8_STRIDE=2531, PHI=(1+Math.sqrt(5))/2;
const key=z=>z.join(',');
const parity=z=>z.reduce((s,x,i)=>s|((x&1)<<i),0);
const dotRaw=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const signed=x=>((x&4095)>=2048?(x&4095)-4096:(x&4095));
const rootPairs=exactRootPairs();
const baseRoots=rootPairs.flatMap(q=>{
 const z=q.flatMap(([a,b])=>[Number(a),Number(b)]);
 return [z,z.map(x=>-x)];
});
const phiRoot=z=>z.flatMap((_,i)=>i%2?[]:[[z[i+1],z[i]+z[i+1]]]).flat();
export const E8_ROOTS=Object.freeze([...baseRoots,...baseRoots.map(phiRoot)]
 .map(z=>Object.freeze(z)));
const rootIndex=new Map(E8_ROOTS.map((z,i)=>[key(z),i]));
if(rootIndex.size!==240)throw Error('E8 icosian roots must be 240 distinct');
for(let i=0;i<E8_ROOTS.length;i++){
 if(dotRaw(E8_ROOTS[i],E8_ROOTS[i])!==4)
  throw Error('E8 root norm is not 2');
 if(i%2===0&&key(E8_ROOTS[i+1])!==key(E8_ROOTS[i].map(x=>-x)))
  throw Error('E8 root antipodes not adjacent');
}
export const E8_PARITY_CODE=(()=>{
 const code=new Set([0]);
 for(const z of E8_ROOTS){
  const m=parity(z);
  for(const x of [...code])code.add(x^m);
 }
 if(code.size!==16)throw Error('Icosian parity code is not rank four');
 for(const m of code){
  const weight=m.toString(2).split('1').length-1;
  if(weight!==0&&weight!==4&&weight!==8)
   throw Error('Icosian code must be doubly even');
 }
 return Object.freeze([...code].sort((a,b)=>a-b));
})();
const codeSet=new Set(E8_PARITY_CODE);
export const E8_CODE_GENERATORS=Object.freeze(
 Array.from({length:4},(_,i)=>{
  const c=E8_PARITY_CODE.find(m=>(m&15)===(1<<i));
  if(c===undefined)throw Error('No systematic icosian code pivot '+i);
  return c;
 })
);
export const E8_BASIS=Object.freeze(Array.from({length:8},(_,j)=>
 Object.freeze(Array.from({length:8},(_,i)=>j<4
  ?(E8_CODE_GENERATORS[j]>>>i)&1:(i===j?2:0)))
));
export const E8_GRAM=Object.freeze(Array.from({length:8},(_,i)=>
 Object.freeze(Array.from({length:8},(_,j)=>{
  const p=dotRaw(E8_BASIS[i],E8_BASIS[j]);
  if(p%2)throw Error('E8 Gram not integral');
  return p/2;
 })))
);
export function isIcosianNumerator(z){
 return z.length===8&&z.every(Number.isInteger)&&codeSet.has(parity(z));
}
export function toIcosianNumerator(k){
 if(k.length!==8||!k.every(Number.isInteger))throw Error('Need eight integer coefficients');
 return Array.from({length:8},(_,i)=>
  E8_BASIS.reduce((s,col,j)=>s+col[i]*k[j],0));
}
export function fromIcosianNumerator(z){
 if(!isIcosianNumerator(z))throw Error('Numerator violates icosian parity code');
 const k=[...z.slice(0,4)];
 for(let i=4;i<8;i++){
  const rest=z[i]-E8_BASIS.slice(0,4).reduce((s,col,j)=>s+col[i]*k[j],0);
  if(rest%2)throw Error('Inconsistent E8 basis parity');
  k[i]=rest/2;
 }
 return k;
}
export const E8_ROOT_STEPS=Object.freeze(E8_ROOTS.map(z=>
 Object.freeze(fromIcosianNumerator(z))));
export function e8Dot(a,b){
 let n=0;
 for(let i=0;i<8;i++)for(let j=0;j<8;j++)
  n+=a[i]*E8_GRAM[i][j]*b[j];
 return n;
}
export const e8Norm=a=>e8Dot(a,a);
export function physical4E8(k){
 const z=toIcosianNumerator(k);
 return Array.from({length:4},(_,i)=>(z[2*i]+PHI*z[2*i+1])/2);
}
export function h4ReflectNumerator(z,rootChannel){
 if(!isIcosianNumerator(z))throw Error('H4 input must be an icosian');
 if(!Number.isInteger(rootChannel)||rootChannel<0||rootChannel>=120)
  throw Error('H4 reflection normal must be an original 600-cell root');
 const r=E8_ROOTS[rootChannel];
 let u=0,v=0;
 for(let i=0;i<4;i++){
  const a=z[2*i],b=z[2*i+1],c=r[2*i],d=r[2*i+1];
  u+=a*c+b*d;
  v+=a*d+b*c+b*d;
 }
 if(u%2||v%2)throw Error('H4 reflection leaves the integral golden module');
 u/=2;v/=2;
 const out=Array.from({length:8});
 for(let i=0;i<4;i++){
  const a=z[2*i],b=z[2*i+1],c=r[2*i],d=r[2*i+1];
  out[2*i]=a-u*c-v*d;
  out[2*i+1]=b-u*d-v*(c+d);
 }
 if(!isIcosianNumerator(out))throw Error('H4 reflection left the icosian lattice');
 return out;
}
export function h4ReflectionMatrix(rootChannel){
 // Columns of the integer action in the *constrained* E8 basis.
 const columns=E8_BASIS.map(z=>fromIcosianNumerator(
  h4ReflectNumerator(z,rootChannel)));
 return Array.from({length:8},(_,i)=>
  Array.from({length:8},(_,j)=>columns[j][i]));
}
export function applyE8Matrix(k,m,{modular=false}={}){
 const x=Array.from({length:8},(_,i)=>m[i].reduce((s,a,j)=>s+a*k[j],0));
 return modular?x.map(v=>v&4095):x;
}
export function transformE8Root(ch,rootNormal){
 const out=h4ReflectNumerator(E8_ROOTS[ch],rootNormal);
 const index=rootIndex.get(key(out));
 if(index===undefined)throw Error('H4 action escaped E8 root set');
 return index;
}
export function transformE8ChannelWithMatrix(ch,m){
 const next=applyE8Matrix(E8_ROOT_STEPS[ch],m);
 const index=rootIndex.get(key(toIcosianNumerator(next)));
 if(index===undefined)throw Error('Matrix escaped 240 E8 roots');
 return index;
}
export function e8RootReflection(ch,control){
 if(!Number.isInteger(ch)||ch<0||ch>=240||
    !Number.isInteger(control)||control<0||control>=240)
  throw Error('Invalid E8 scattering channel');
 const r=E8_ROOT_STEPS[ch],n=E8_ROOT_STEPS[control];
 const p=e8Dot(r,n);
 const out=r.map((x,i)=>x-p*n[i]);
 const index=rootIndex.get(key(toIcosianNumerator(out)));
 if(index===undefined)throw Error('E8 root reflection left 240-root shell');
 return index;
}
export function scatterPairE8(a,b,control){
 const m=E8_ROOT_STEPS[a].map((x,i)=>x+E8_ROOT_STEPS[b][i]);
 if(e8Dot(m,E8_ROOT_STEPS[control])!==0)
  return {a,b,control,changed:false,eligible:false};
 const nextA=e8RootReflection(a,control);
 const nextB=e8RootReflection(b,control);
 return {a:nextA,b:nextB,control,
  changed:nextA!==a||nextB!==b,eligible:true};
}
export function equivariantGateInvariantE8(k,ch){
 if(!Number.isInteger(ch)||ch<0||ch>=240)throw Error('Invalid E8 channel');
 const root=E8_ROOT_STEPS[ch];
 const p=e8Dot(k,root),q=e8Norm(k);
 return (2*q-p*p)&4095;
}
export function equivariantGatePhaseE8(k,ch,t,seed=0){
 return (equivariantGateInvariantE8(k,ch)+Math.imul(t,E8_STRIDE)+(seed>>>0))&4095;
}
export function stepE8(p,t,{reverse=false,seed=0,threshold=3072}={}){
 if(!Number.isInteger(t)||t<0||t>0xffffffff)throw Error('Invalid step');
 if(!Number.isInteger(threshold)||threshold<0||threshold>4096)throw Error('Invalid threshold');
 const {coords,ch}=p;
 if(equivariantGatePhaseE8(coords,ch,t,seed)>=threshold)
  return {coords:[...coords],ch};
 const root=E8_ROOT_STEPS[ch],direction=reverse?-1:1;
 return {coords:coords.map((x,i)=>(x+direction*root[i])&4095),ch};
}
export function packE8(k,ch){
 if(k.length!==8||k.some(x=>!Number.isInteger(x)||x<0||x>4095))
  throw Error('Need eight 12-bit E8 basis coordinates');
 if(!Number.isInteger(ch)||ch<0||ch>=240)throw Error('Invalid E8 channel');
 return Uint32Array.of(
  (k[0]|(k[1]<<12)|((k[2]&255)<<24))>>>0,
  ((k[2]>>>8)|(k[3]<<4)|(k[4]<<16)|((k[5]&15)<<28))>>>0,
  ((k[5]>>>4)|(k[6]<<8)|(k[7]<<20))>>>0,ch>>>0
 );
}
export function unpackE8(words,index=0){
 const o=4*index,lo=words[o]>>>0,mid=words[o+1]>>>0,hi=words[o+2]>>>0;
 return {coords:[
  lo&4095,(lo>>>12)&4095,((lo>>>24)|(mid<<8))&4095,
  (mid>>>4)&4095,(mid>>>16)&4095,((mid>>>28)|(hi<<4))&4095,
  (hi>>>8)&4095,(hi>>>20)&4095
 ],ch:words[o+3]>>>0};
}
export function evolveE8Words(words,steps,{start=0,reverse=false,...opts}={}){
 if(!Number.isInteger(steps)||steps<0||!Number.isInteger(start)||start<0)
  throw Error('Invalid E8 evolution window');
 if(words.length%4)throw Error('Misaligned E8 records');
 const out=new Uint32Array(words.length);
 for(let i=0;i<words.length/4;i++){
  let p=unpackE8(words,i);
  for(let j=0;j<steps;j++){
   const t=reverse?start+steps-1-j:start+j;
   p=stepE8(p,t,{...opts,reverse});
  }
  out.set(packE8(p.coords,p.ch),4*i);
 }
 return out;
}
export function sampleE8Records(count=4096,{seed=17,spread=2}={}){
 if(!Number.isInteger(count)||count<1||count>131072)throw Error('Invalid count');
 const out=new Uint32Array(count*4);
 let s=seed>>>0;
 const mix=x=>{let y=x>>>0;y^=y>>>16;y=Math.imul(y,0x7feb352d);y^=y>>>15;y=Math.imul(y,0x846ca68b);return (y^(y>>>16))>>>0;};
 for(let i=0;i<count;i++){
  const k=Array.from({length:8},(_,a)=>{
   s=mix(s^Math.imul(i+1,0x9e3779b9)^Math.imul(a+1,0x85ebca6b));
   return ((s%(2*spread+1))-spread)&4095;
  });
  out.set(packE8(k,(i*73+seed)%240),4*i);
 }
 return out;
}
export const signedE8Coordinate=signed;
