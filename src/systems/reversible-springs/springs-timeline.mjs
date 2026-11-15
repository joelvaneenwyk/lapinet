export class SpringCoefficientTimeline {
 constructor(graph) {
  this.events=[{tick:0,values:{
   stiffness:graph.stiffness,cutoff:graph.cutoff,restScale256:graph.restScale256??256,
   alignment:graph.alignment??0,coupling:graph.coupling??0,
   cohesion:graph.cohesion??0,separation:graph.separation??0,steering:graph.steering??0
  }}];
 }
 eventAt(tick) {
  if(!Number.isSafeInteger(tick)||tick<0)throw Error('Invalid timeline tick');
  let found=this.events[0];
  for(const event of this.events) {
   if(event.tick>tick)break;
   found=event;
  }
  return found;
 }
 at(tick) {return this.eventAt(tick).values}
 nextTick(tick) {
  return this.events.find(event=>event.tick>tick)?.tick??Infinity;
 }
 change(tick,patch) {
  if(!Number.isSafeInteger(tick)||tick<0)throw Error('Invalid tick');
  const prev=this.at(tick),values={...prev,...patch};
  for(const [key,lo,hi] of [
   ['stiffness',0,64],['cutoff',8,512], ['restScale256',64,512],['alignment',0,64],['coupling',0,64],
   ['cohesion',0,64],['separation',0,64],['steering',0,64]
  ]) {
   if(!Number.isSafeInteger(values[key])||lo>values[key]||values[key]>hi)
    throw Error('Invalid '+key);
  }
  for(const name in patch) {
   if(!['stiffness','cutoff','restScale256','alignment','coupling',
    'cohesion','separation','steering'].includes(name))throw Error('Unknown coefficient');
  }
  const unchanged=values.stiffness===prev.stiffness&&
   values.cutoff===prev.cutoff&&values.restScale256===prev.restScale256&&
   values.alignment===prev.alignment&&values.coupling===prev.coupling&&
   values.cohesion===prev.cohesion&&values.separation===prev.separation&&
   values.steering===prev.steering;
  if(unchanged&&!this.events.some(e=>e.tick>tick))return null;
  this.events=this.events.filter(e=>tick>e.tick);
  const event={tick,values:Object.freeze(values)};
  this.events.push(event);
  return event;
 }
}
export function evolveWithCoefficients(state,graph,timeline,tick,count,step,{reverse=false}={}) {
 let result=state.slice();
 for(let i=0;count>i;i++) {
  const t=reverse?tick-1-i:tick+i;
  if(0>t)throw Error('Cannot reverse past zero');
  result=step(result,{...graph,...timeline.at(t)},{reverse});
 }
 return result;
}
