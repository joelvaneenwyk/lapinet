/** Exact 600-cell/binary-icosahedral geometry in Z[φ], φ²=φ+1.
 * Ring coordinates are [a,b] := a+bφ. H4 quaternion root coordinates are /2.
 * No floating-point arithmetic is used to generate the geometry or fixed-point
 * transport coefficients; integer BigInt is deliberately used during setup.
 * Runtime WGSL continues to use packed u32 masks and integer phase hashes.
 */
export const H4_ROOT_COUNT = 120;
export const H4_PAIR_COUNT = 60;
export const H4_CHANNEL_COUNT = 120;
export const PHASE_BITS = 24;
export const PHASE_MAX = (1 << PHASE_BITS) - 1;
export const SEED_DENOMINATOR = 100000000n;

const I=(a,b=0n)=>[BigInt(a),BigInt(b)];
const ZERO=I(0),ONE=I(1),PHI=I(0,1);
export const golden = Object.freeze({
  add:(u,v)=>[u[0]+v[0],u[1]+v[1]],
  neg:u=>[-u[0],-u[1]],
  sub:(u,v)=>[u[0]-v[0],u[1]-v[1]],
  mul:(u,v)=>[u[0]*v[0]+u[1]*v[1],u[0]*v[1]+u[1]*v[0]+u[1]*v[1]],
  eq:(u,v)=>u[0]===v[0]&&u[1]===v[1],
});
const {add,neg,sub,mul,eq}=golden;
const signN=n=>n<0n?-1:n>0n?1:0;
const absN=n=>n<0n?-n:n;
/** Exact sign of a+bφ. For opposite signs compare |a|/|b| to φ using x²-x-1. */
export function goldenSign(x){
  const [a,b]=x;
  if(a===0n)return signN(b);
  if(b===0n)return signN(a);
  if(signN(a)===signN(b))return signN(a);
  const A=absN(a),B=absN(b),c=A*A-A*B-B*B;
  if(c===0n)throw Error('Impossible: rational |a|/|b| equals irrational φ');
  return c<0n?signN(b):signN(a);
}
export const goldenCmp=(u,v)=>goldenSign(sub(u,v));
export const goldenAbs=u=>goldenSign(u)<0?neg(u):u;
const key=x=>x.map(t=>t[0]+','+t[1]).join(';');
const vecZero=n=>Array.from({length:n},()=>ZERO);
const parity=p=>{let k=0;for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)k+=(p[i]>p[j]);return k&1;};
const evenPermutations=()=>{const out=[];for(let a=0;a<4;a++)for(let b=0;b<4;b++)if(a!==b)for(let c=0;c<4;c++)if(c!==a&&c!==b)for(let d=0;d<4;d++)if(d!==a&&d!==b&&d!==c){const p=[a,b,c,d];if(parity(p)===0)out.push(p);}return out;};

export function generateExactH4Roots(){
  const roots=[];
  for(let axis=0;axis<4;axis++)for(const sign of [-1,1]){
    const v=vecZero(4);v[axis]=I(2*sign);roots.push(v);
  }
  for(let mask=0;mask<16;mask++)roots.push(Array.from({length:4},(_,i)=>I((mask>>i)&1?1:-1)));
  const even=evenPermutations();
  for(const s1 of [-1,1])for(const sp of [-1,1])for(const si of [-1,1]){
    const base=[ZERO,I(s1),I(0,sp),I(-si,si)];
    for(const p of even)roots.push(p.map(i=>base[i]));
  }
  const keys=new Set(roots.map(key));
  if(keys.size!==120||roots.length!==120)throw Error('H4 root enumeration not unique');
  // Every root has norm exactly 1:  Σ (numerator/2)^2 = 1.
  for(const r of roots){let norm=ZERO;for(const c of r)norm=add(norm,mul(c,c));if(!eq(norm,I(4)))throw Error('H4 root has non-unit exact norm: '+key(r));}
  return roots;
}
export function exactRootPairs(){
  const roots=generateExactH4Roots(),all=new Map(roots.map(r=>[key(r),r]));const seen=new Set(),pairs=[];
  for(const r of roots){const k=key(r);if(seen.has(k))continue;const rn=r.map(neg);if(!all.has(key(rn)))throw Error('missing antipode');seen.add(k);seen.add(key(rn));const first=r.find(c=>goldenSign(c)!==0);pairs.push(goldenSign(first)<0?rn:r);}
  pairs.sort((a,b)=>{for(let i=0;i<4;i++){const c=goldenCmp(a[i],b[i]);if(c)return c;}return 0;});
  if(pairs.length!==60)throw Error('expected exactly 60 antipodal pairs');
  return pairs;
}

/** Multiply binary icosahedral H4 elements; inputs and output represented as numerator/2. */
export function quaternionMulExact(a,b){
  const [aw,ax,ay,az]=a,[bw,bx,by,bz]=b;
  const raw=[
    sub(sub(sub(mul(aw,bw),mul(ax,bx)),mul(ay,by)),mul(az,bz)),
    add(add(sub(mul(aw,bx),mul(az,by)),mul(ax,bw)),mul(ay,bz)),
    add(add(sub(mul(aw,by),mul(ax,bz)),mul(ay,bw)),mul(az,bx)),
    add(add(sub(mul(aw,bz),mul(ay,bx)),mul(ax,by)),mul(az,bw)),
  ];
  return raw.map(([u,v])=>{if((u&1n)!==0n||(v&1n)!==0n)throw Error('product outside icosian half-ring');return [u/2n,v/2n];});
}
export const quaternionConjExact=q=>[q[0],...q.slice(1).map(neg)];
/** SO(3) matrix, columns are exact rotated unit basis vectors (numerators /2). */
export function rotationColumnsExact(q){
  const qb=quaternionConjExact(q);
  return [1,2,3].map(i=>{const e=vecZero(4);e[i]=I(2);const r=quaternionMulExact(quaternionMulExact(q,e),qb);if(goldenSign(r[0])!==0)throw Error('quaternion conjugation produced nonzero scalar');return r.slice(1);});
}

/** Exact rational seed triples, numerator /100000000. Near the prior four visual seeds. */
export const COHERENT_SEEDS = Object.freeze([
  Object.freeze([-70995735n, 29412262n, 63988471n]),
  Object.freeze([-54299961n,  7539562n, 83634140n]),
  Object.freeze([-68471094n, 46663267n, 55984361n]),
  Object.freeze([-64921319n, 30381042n, 69729582n]),
]);

/** Each output component is an exact Q(φ) numerator / (2*seedDenominator).
 * Unlike normalized floats, we preserve a common seed length algebraically.
 */
export function rotateSeedExact(q,seed){
  const columns=rotationColumnsExact(q);const out=vecZero(3).map(()=>ZERO);
  for(let axis=0;axis<3;axis++)for(let j=0;j<3;j++)out[axis]=add(out[axis],mul(columns[j][axis],I(seed[j])));
  return out;
}
export function squaredNorm(v){let n=ZERO;for(const c of v)n=add(n,mul(c,c));return n;}
/** Determine rounded integer k = round(S*|component|/sqrt(norm2)) exactly,
 * comparing squared values in Z[φ], using integer BigInt only. No sqrt/float.
 */
export function exactThreshold(component,norm2,S=BigInt(PHASE_MAX)){
  if(goldenSign(norm2)<=0)throw Error('nonpositive norm');
  const v2=mul(component,component),scale2=S*S;
  const cmpTo=k=>goldenSign(sub(mul(I(scale2),v2),mul(I(k*k),norm2)));
  let lo=0n,hi=S;
  while(lo<hi){const mid=(lo+hi+1n)>>1n;if(cmpTo(mid)>=0)lo=mid;else hi=mid-1n;}
  if(lo===S)return Number(S);
  // Compare 4*S^2*component^2 to (2*lo+1)^2*norm2.
  const left=mul(I(4n*scale2),v2),right=mul(I((2n*lo+1n)**2n),norm2);
  return Number(lo+(goldenSign(sub(left,right))>=0?1n:0n));
}
export function exactH4Params({seeds=COHERENT_SEEDS}={}){
  const pairs=exactRootPairs(),polytypes=seeds.length;
  const params=new Uint32Array(pairs.length*polytypes*4);
  const rotations=pairs.map(rotationColumnsExact);
  for(let pair=0;pair<pairs.length;pair++)for(let poly=0;poly<polytypes;poly++){
    const s=seeds[poly],cols=rotations[pair],d=vecZero(3).map(()=>ZERO);
    for(let axis=0;axis<3;axis++)for(let j=0;j<3;j++)d[axis]=add(d[axis],mul(cols[j][axis],I(s[j])));
    const norm2=squaredNorm(d);
    const o=(pair*polytypes+poly)*4;
    for(let axis=0;axis<3;axis++)params[o+axis]=exactThreshold(d[axis],norm2);
    const signs=d.reduce((a,c,i)=>a|((goldenSign(c)>=0?1:0)<<i),0);
    const abs=d.map(goldenAbs);
    const primary=goldenCmp(abs[1],abs[0])>0?(goldenCmp(abs[2],abs[1])>0?2:1):(goldenCmp(abs[2],abs[0])>0?2:0);
    params[o+3]=(signs<<2)|primary;
  }
  return {pairs,seeds,params};
}

// 32-bit-only runtime, modeled on the H4 WGSL kernel.
const PHI32=0x9e3779b9>>>0, SQRT2M1_32=0x6a09e667>>>0, SQRT3M1_32=0xbb67ae85>>>0, SQRT5M2_32=0x3c6ef372>>>0;
const mul32=(a,b)=>Math.imul(a,b)>>>0;
export function exactRuntimePhase24(axis,p,pair,salt=0){
  const [x,y,z]=p,s=salt>>>0;let h;
  if(axis===0)h=(mul32(y,PHI32)+mul32(z,SQRT2M1_32)+mul32(pair,SQRT3M1_32)+mul32(s,SQRT5M2_32))>>>0;
  else if(axis===1)h=(mul32(x,SQRT2M1_32)+mul32(z,SQRT3M1_32)+mul32(pair,SQRT5M2_32)+mul32(s,PHI32))>>>0;
  else h=(mul32(x,SQRT3M1_32)+mul32(y,PHI32)+mul32(pair,SQRT2M1_32)+mul32(s,SQRT5M2_32))>>>0;
  return h>>>8;
}
export function exactRuntimeMove(params,pair,p,step,polytypes=4){
  const axis=step%3,cycle=Math.floor(step/3)>>>0;
  const hash=exactRuntimePhase24(axis,p,pair,17);
  if(polytypes!==4 && polytypes!==32)throw Error("expected 4 or 32 polytypes");
  const poly=(hash>>>(polytypes===4?22:19))&(polytypes-1);
  const o=(pair*polytypes+poly)*4;
  const phase=(exactRuntimePhase24(axis,p,pair,poly+41)+((mul32(cycle,PHI32)>>>8)))&PHASE_MAX;
  if(phase>=params[o+axis])return 0;
  return ((params[o+3]>>>(axis+2))&1)?1:-1;
}
