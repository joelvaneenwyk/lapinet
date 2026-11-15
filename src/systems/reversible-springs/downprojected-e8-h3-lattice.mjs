// Exact E8 240-root shell projected through Cycles' golden Q6/H3 map.
// Source: Cycles/work/Crystals/src/camera-presets.js and
// Cycles/work/metis/E8_H3_B3_RESEARCH_CHECKPOINT_2026-10-08.md
// Unlike H4 quaternion slicing, this is a linear map from E8 R8 to R3.
// Axes 0 and 4 of the 8D E8 basis are invisible.
export const PHI=(1+Math.sqrt(5))/2;
export const VISIBLE=[1,2,3,5,6,7];
const n=Math.sqrt(2*(1+PHI*PHI));
export const H3_COLUMNS=[
 [1,PHI,0],[PHI,0,1],[0,1,PHI],[-1,PHI,0],[PHI,0,-1],[0,-1,PHI]
].map(v=>Object.freeze(v.map(x=>x/n)));
export function projectE8H3(root){
 if(root.length!==8||Array.from(root).some(x=>!Number.isInteger(x)))
  throw Error('Expected eight doubled integer coordinates');
 const p=[0,0,0];
 for(let i=0;i<6;i++)for(let k=0;k<3;k++)
  p[k]+=root[VISIBLE[i]]*H3_COLUMNS[i][k]/2;
 return p;
}
export function e8RootShell(){
 const roots=[];
 for(let i=0;i<8;i++)for(let j=i+1;j<8;j++)
  for(const a of [-2,2])for(const b of [-2,2]){
   const v=Array(8).fill(0);v[i]=a;v[j]=b;roots.push(v);
  }
 for(let mask=0;mask<256;mask++){
  let parity=0;
  for(let i=0;i<8;i++)parity+=(mask>>>i)&1;
  if(parity%2===0)roots.push(Array.from({length:8},(_,i)=>
   (mask&(1<<i))?-1:1));
 }
 if(roots.length!==240||roots.some(v=>v.reduce((s,x)=>s+x*x,0)!==8))
  throw Error('Invalid E8 root-shell enumeration');
 return roots;
}
const key=p=>p.map(x=>(Math.abs(x)<1e-12?0:x).toFixed(10)).join(',');
export function generateProjectedE8H3Lattice({kind='q6',worldScale=1}={}){
 if(!['q6','shell'].includes(kind))throw Error('Unknown E8 graph kind');
 if(!Number.isFinite(worldScale)||worldScale<=0)throw Error('Invalid scale');
 const roots=e8RootShell(),positions=roots.map(projectE8H3),keys=positions.map(key);
 const counts=new Map();for(const k of keys)counts.set(k,(counts.get(k)||0)+1);
 const fibers={};
 for(const n of counts.values())fibers[n]=(fibers[n]||0)+1;
 if(counts.size!==137||fibers[1]!==60||fibers[2]!==64||fibers[4]!==13)
  throw Error('E8 projection must have 137 sites, fibers 60/64/13');
 const vertices=[],seen=new Set();
 let rawEdges=0,collapsed=0,duplicates=0;
 function edge(i,j){
  rawEdges++;
  const a=keys[i],b=keys[j];
  if(a===b){collapsed++;return;}
  const k=a<b?a+'|'+b:b+'|'+a;
  if(seen.has(k)){duplicates++;return;}
  seen.add(k);
  vertices.push(...positions[i].map(x=>x*worldScale),1,
                ...positions[j].map(x=>x*worldScale),1);
 }
 if(kind==='shell'){
  for(let i=0;i<roots.length;i++)for(let j=i+1;j<roots.length;j++)
   if(roots[i].reduce((s,x,k)=>s+x*roots[j][k],0)===4)edge(i,j);
 }else{
  const visible=new Map();
  for(let i=0;i<roots.length;i++){
   const r=roots[i];
   if(r.every(x=>Math.abs(x)===1)){
    const bits=VISIBLE.reduce((n,axis,j)=>n|(r[axis]<0?(1<<j):0),0);
    if(!visible.has(bits))visible.set(bits,i);
   }
  }
  if(visible.size!==64)throw Error('Q6 requires 64 E8 doublets');
  for(let mask=0;mask<64;mask++)for(let axis=0;axis<6;axis++){
   const other=mask^(1<<axis);
   if(mask<other)edge(visible.get(mask),visible.get(other));
  }
 }
 return {vertices:new Float32Array(vertices),
  sourceRootCount:roots.length,siteCount:kind==='q6'?64:240,
  distinctProjectedSites:kind==='q6'?64:counts.size,
  edgeCount:vertices.length/8,rawEdges,collapsed,duplicates,
  fibers,kind,source:'E8 / Cycles Q6 -> H3 golden'};
}
