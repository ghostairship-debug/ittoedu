export const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number(x)||0));
export const smooth=x=>{x=clamp(x);return x*x*(3-2*x)};
export function prepareStops(input){
 if(!Array.isArray(input)||input.length<2)throw Error('At least two color stops are required');
 const stops=input.map(s=>{if(!Number.isFinite(s.at)||!/^#[0-9a-f]{6}$/i.test(s.color))throw Error('Stops require finite at and #RRGGBB');return{at:s.at,rgb:[1,3,5].map(i=>parseInt(s.color.slice(i,i+2),16))}});
 if(stops.some((s,i)=>i&&s.at<=stops[i-1].at))throw Error('Color stops must be strictly increasing');
 return stops;
}
export function sampleColor(stops,value){
 let left=stops[0],right=left;
 for(let i=1;i<stops.length;i++){right=stops[i];if(value<=right.at)break;left=right;}
 const t=right.at===left.at?0:smooth((value-left.at)/(right.at-left.at));
 return 'rgb('+left.rgb.map((x,i)=>Math.round(x+(right.rgb[i]-x)*t)).join(',')+')';
}
export function phaseFromStops(value,stops){
 if(stops.length<2)return 0;
 for(let i=1;i<stops.length;i++)if(value<=stops[i])return i-1+clamp((value-stops[i-1])/(stops[i]-stops[i-1]));
 return stops.length-1;
}
export function createInvalidator(win,scope,paint){
 let raf=0,dead=false,paused=false;
 const request=()=>{if(!dead&&!paused&&!raf)raf=win.requestAnimationFrame(()=>{raf=0;if(!dead&&!paused&&scope.isActive())paint()})};
 const suspend=()=>{paused=true;if(raf)win.cancelAnimationFrame(raf);raf=0};
 const resume=()=>{paused=false;request()};
 const dispose=()=>{dead=true;suspend()};
 scope.cleanup(dispose);return{request,suspend,resume,dispose};
}
