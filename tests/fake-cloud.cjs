'use strict';
// Test-only transport. Not packaged, not selectable by an environment variable.
function fakeCloud() {
  const counters={photo:-1,video:14098}, reservations=new Map();
  const session=()=>({access_token:'test-access',refresh_token:'test-refresh',expires_in:3600,user:{id:'test-user',email:'notebook@example.test'}});
  let offline=false, calls=[];
  async function request(route, body) {
    calls.push({route,body});
    if(offline)throw Error('Sin conexión de prueba');
    if(route.startsWith('/auth/v1/token'))return session();
    if(route==='/auth/v1/signup'||route==='/auth/v1/resend'||route==='/auth/v1/recover')return {};
    if(route==='/auth/v1/verify')return session();
    if(route==='/auth/v1/user')return session().user;
    if(route.startsWith('/auth/v1/logout'))return {};
    if(route.endsWith('sync_counters')) {
      counters.photo=Math.max(counters.photo,body.p_photo);
      counters.video=Math.max(counters.video,body.p_video);
      return {...counters};
    }
    if(route.endsWith('reserve_numbers')) {
      const key=body.p_request, existing=reservations.get(key);
      if(existing) {
        if(existing.start!==body.p_start||existing.end!==body.p_end||existing.kind!==body.p_kind)throw Error('Solicitud diferente');
      } else {
        if(body.p_start<=counters[body.p_kind])throw Error('La numeración avanzó en otro equipo. Sincronizá.');
        counters[body.p_kind]=body.p_end;
        reservations.set(key,{start:body.p_start,end:body.p_end,kind:body.p_kind});
      }
      return {start:body.p_start,end:body.p_end,...counters};
    }
    throw Error('Unexpected fake route: '+route);
  }
  return {request,counters,reservations,calls,setOffline:value=>{offline=value;}};
}
module.exports={fakeCloud};
