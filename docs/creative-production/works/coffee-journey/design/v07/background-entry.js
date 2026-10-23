import './background-assets.css';
import implementation from './background-runtime.js';

// CSS url() is the host's supported binary resource closure. The probe stays inside
// this component; it never inspects the host document or controls navigation.
export default {
 mount(context){
  const doc=context.root.ownerDocument,probe=doc.createElement('i');
  probe.className='coffee-v07-material-resources';probe.hidden=true;context.root.append(probe);
  const style=doc.defaultView.getComputedStyle(probe),assets={};
  for(const name of ['cup','cherry','section','green','gold','roast']){
   const value=style.getPropertyValue('--coffee-v07-'+name).trim();
   assets[name]=value.replace(/^url\(["']?/,'').replace(/["']?\)$/,'');
  }
  probe.remove();
  const decorate=instance=>({...instance,data:{...instance.data,assets}});
  const mounted=implementation.mount({...context,instance:decorate(context.instance)});
  return {...mounted,update(next){mounted.update(decorate(next))}};
 }
};
