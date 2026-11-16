'use strict';
function applyCloudState(state) {
  if (!state) return;
  const previousEmail = account.email;
  account = state;
  $('accountButton').textContent = state.signedIn ? 'Mi cuenta' : 'Iniciar sesión';
  $('cloudLabel').textContent = state.signedIn ? (state.online ? 'Numeración en la nube' : 'Revisar conexión') : 'Cuenta sin vincular';
  $('cloudLabel').classList.toggle('connected', state.signedIn && state.online);
  if (state.counters) {
    const next = state.counters.photo + 1;
    $('nextNumber').textContent = String(next);
    $('start').min = String(next);
    if (Number($('start').value) < next) $('start').value = String(next);
    if (plan && plan.config.start <= state.counters.photo && !busy) invalidate();
  }
  if (state.videoSequence) { videoSequence = state.videoSequence; renderVideos(); }
  if (previousEmail !== state.email && !busy) invalidate();
  controls();
}
api.onCloudState(applyCloudState);

function accountField(labelText, id, type, value = '') {
  const label = el('label', '', labelText), input = el('input');
  input.id = id; input.type = type; input.value = value;
  label.append(input);
  return {label,input};
}
function showAccount(message = '') {
  if (operationPending()) return;
  const body = openModal(account.signedIn ? 'Tu cuenta PhotoBatch' : 'Vinculá tus equipos');
  body.className = 'account-body';
  const status = el('p','account-message',message || account.message);
  status.setAttribute('role','status');
  async function run(button, action, data, done) {
    if (accountBusy) return;
    accountBusy = true;
    const buttons = [...body.querySelectorAll('button')];
    buttons.forEach(b => {b.disabled=true;});
    $('closeModal').disabled = true;
    status.textContent = 'Conectando…';
    controls();
    try {
      const state = await api.accountAction(action,data);
      applyCloudState(state);
      accountBusy = false;
      done?.(state);
    } catch (error) { status.textContent = error.message; }
    finally {
      accountBusy = false;
      buttons.forEach(b => {b.disabled=false;});
      $('closeModal').disabled = false;
      controls();
    }
  }
  if (account.signedIn) {
    body.append(el('p','account-email',account.email),el('p','muted',
      'Esta cuenta comparte la numeración entre tus equipos. Tus archivos y el historial detallado permanecen en cada equipo.'));
    const grid=el('div','two account-counters');
    const photo=accountField('Próximo inicio de fotos','accountPhoto','number',account.counters ? account.counters.photo+1 : $('start').value);
    const video=accountField('Próximo número de video','accountVideo','number',account.counters ? account.counters.video+1 : 14099);
    photo.input.min=String(account.counters?.photo+1 || 0); video.input.min=String(account.counters?.video+1 || 14099);
    photo.input.max=video.input.max='999999999'; photo.input.step=video.input.step='1';
    grid.append(photo.label,video.label);body.append(grid);
    const sync=el('button','secondary','Sincronizar ahora'), advance=el('button','primary','Guardar próximos números'),logout=el('button','text-button','Cerrar sesión en este equipo');
    sync.id='accountSync'; advance.id='accountAdvance';logout.id='accountLogout';
    sync.onclick=()=>run(sync,'sync',{},()=>showAccount('Numeración sincronizada. Se conservó el mayor número de la cuenta y este equipo.'));
    advance.onclick=()=>{
      const next={photo:Number(photo.input.value),video:Number(video.input.value)};
      if(!photo.input.value||!video.input.value||!photo.input.checkValidity()||!video.input.checkValidity()) {status.textContent='Solo podés adelantar la numeración. Revisá ambos números.';return;}
      if(!confirm(`Se continuará desde ${next.photo} en fotos y ${next.video} en videos. Los números anteriores quedarán reservados y no se podrán recuperar. ¿Guardar?`))return;
      run(advance,'advance',next,()=>showAccount('Próximos números guardados en tu cuenta.'));
    };
    logout.onclick=()=>run(logout,'logout',{},()=>showAccount('Sesión cerrada en este equipo.'));
    const actions=el('div','account-actions');actions.append(sync,advance);
    body.append(el('p','micro','Solo se puede avanzar. Elegí el próximo número que querés usar. Si ya exportaste, se incorporó automáticamente el último rango utilizado.'),actions,status,logout);
  } else {
    body.append(el('p','muted','Usá la misma cuenta en la notebook y la PC. Al ingresar se incorpora automáticamente el número más alto de este equipo; nunca se reduce el de la nube.'));
    const email=accountField('Correo','accountEmail','email');email.input.autocomplete='username';
    const password=accountField('Contraseña','accountPassword','password');password.input.autocomplete='current-password';password.input.maxLength=256;
    body.append(email.label,password.label);
    const actions=el('div','account-actions'),login=el('button','primary','Iniciar sesión'),signup=el('button','secondary','Crear cuenta');
    login.id='accountLogin';signup.id='accountSignup';
    const credentials=()=>({email:email.input.value,password:password.input.value});
    const signedIn=()=>{password.input.value='';showAccount('Cuenta vinculada. La numeración de este equipo ya está incorporada.');};
    login.onclick=()=>run(login,'login',credentials(),signedIn);
    signup.onclick=()=>run(signup,'signup',credentials(),s=>{
      password.input.value='';
      if(s.signedIn)signedIn();
      else {status.textContent='Revisá tu correo y spam. Copiá el enlace del botón de confirmación y pegalo abajo.';verification.open=true;}
    });
    password.input.onkeydown=e=>{if(e.key==='Enter')login.click();};
    actions.append(login,signup);body.append(actions,status);
    const verification=el('details','account-verification');verification.append(el('summary','','Confirmar correo o recuperar contraseña'));
    verification.append(el('p','micro','En el correo de Supabase, hacé clic derecho sobre el botón y elegí Copiar enlace. Pegalo acá sin abrirlo. Si ya confirmaste el correo, ingresá arriba con tu contraseña.'));
    const link=accountField('Enlace del correo','accountLink','text');link.input.autocomplete='off';link.input.spellcheck=false;
    const newPassword=accountField('Nueva contraseña (solo para recuperación)','accountNewPassword','password');newPassword.input.autocomplete='new-password';
    const verify=el('button','secondary','Confirmar enlace'),resend=el('button','text-button','Reenviar confirmación'),recover=el('button','text-button','Olvidé mi contraseña');
    verify.onclick=()=>run(verify,'verify',{link:link.input.value,password:newPassword.input.value},()=>{link.input.value='';newPassword.input.value='';signedIn();});
    resend.onclick=()=>run(resend,'resend',{email:email.input.value},()=>{status.textContent='Si corresponde, recibirás otro correo de confirmación.';});
    recover.onclick=()=>run(recover,'recover',{email:email.input.value},()=>{status.textContent='Si la cuenta existe, recibirás un enlace. Pegalo acá y elegí una contraseña nueva de al menos 10 caracteres.';});
    verification.append(link.label,newPassword.label,verify,resend,recover);body.append(verification,
      el('p','micro','Creá tu cuenta con el correo que usás en Supabase. El envío de correos está limitado a miembros del proyecto hasta configurar un proveedor de correo. La contraseña de PhotoBatch es independiente.'));
  }
}
$('accountButton').onclick=()=>showAccount();
$('modal').addEventListener('cancel',event=>{if(accountBusy)event.preventDefault();});
window.addEventListener('focus',async()=>{
  if(!account.signedIn || operationPending() || $('modal').open)return;
  accountBusy=true;controls();
  try{applyCloudState(await api.accountAction('sync'));}
  catch(error){$('cloudLabel').textContent='Revisar conexión';}
  finally{accountBusy=false;controls();}
});
