import {levels} from './commercial-permissions.mjs';
import {randomBytes} from 'node:crypto';
import {fail,validCpf} from './model.mjs';
export async function createOperator(db,auth,b,user,env){
 if(user.uid!==env.COMMERCIAL_OWNER_UID)fail(403,'Somente o proprietário pode cadastrar usuários comerciais.');
 const name=typeof b.name==='string'?b.name.trim():'',email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
 if(name.length<2||name.length>120||/[<>\x00-\x1f]/.test(name)||email.length>160||!/^\S+@\S+\.\S+$/.test(email))fail(400,'Informe nome e e-mail válidos.');
 if(b.accessLevel!==undefined&&!levels.includes(b.accessLevel))fail(400,'Função de acesso inválida.');const details={};for(const [k,max]of [['cpf',14],['phone',30],['whatsapp',30],['position',80],['address',250],['birthDate',10]]){const v=b[k]??'';if(typeof v!=='string'||v.length>max||/[<>\x00-\x1f]/.test(v))fail(400,'Confira os dados pessoais.');details[k]=v.trim();}details.cpf=details.cpf.replace(/\D/g,'');if(details.cpf&&!validCpf(details.cpf))fail(400,'CPF inválido.');if(details.birthDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(details.birthDate)||!Number.isFinite(Date.parse(details.birthDate+'T12:00:00Z'))||new Date(details.birthDate+'T12:00:00Z').toISOString().slice(0,10)!==details.birthDate))fail(400,'Data de nascimento inválida.');
 try{await auth.getUserByEmail(email);fail(409,'Este e-mail já possui uma conta. Nenhuma senha foi alterada.');}catch(e){if(e.code!=='auth/user-not-found')throw e;}
 const temporaryPassword='Se7!'+randomBytes(18).toString('base64url');let created;
 try{created=await auth.createUser({email,displayName:name,password:temporaryPassword,disabled:false});await db.runTransaction(async tx=>{
 const cat=db.collection('commercialPrivate').doc('catalog'),c=await tx.get(cat),profile=await tx.get(db.collection('commercialProfiles').doc(user.uid)),counterRef=db.collection('commercialPrivate').doc('collaboratorSequence'),counter=await tx.get(counterRef),number=(counter.data()?.value||0)+1;const registration='COL-'+String(number).padStart(4,'0');created.registration=registration;tx.set(counterRef,{value:number});
 const event={at:new Date().toISOString(),actorUid:user.uid,actorName:profile.data()?.name||user.name||env.COMMERCIAL_OWNER_NAME||'Proprietário',actorEmail:user.email||'',message:'Cadastrou usuário comercial: '+name,changes:[{type:'Usuário comercial',name,action:'Cadastro',fields:[{label:'E-mail',before:'Não cadastrado',after:email},{label:'Permissão',before:'Sem acesso',after:'Administrador comercial'}]}]};
 tx.create(db.collection('commercialOperators').doc(created.uid),{name,email,...details,collaboratorNumber:number,registration,role:'admin',accessLevel:b.accessLevel||'full',revision:0,enabled:true,mustChangePassword:true,createdAt:event.at,createdBy:user.uid});tx.create(db.collection('commercialProfiles').doc(created.uid),{name,email,...details,collaboratorNumber:number,registration,position:details.position||'Colaborador comercial'});tx.create(db.collection('commercialAudit').doc(),event);
 if(c.exists)tx.update(cat,{revision:(c.data().revision||0)+1,history:[event,...(c.data().history||[])].slice(0,100)});
 });return {email,name,registration:created.registration,temporaryPassword};}catch(e){if(created)await auth.deleteUser(created.uid).catch(()=>{});throw e;}
}
export async function changeOperatorPassword(db,auth,b,user){
 if(!user.mustChangePassword||user.commercialRole!=='admin')fail(409,'Esta conta não tem troca inicial pendente.');
 if(typeof b.password!=='string'||b.password.length<12||b.password.length>128||!/[A-Za-z]/.test(b.password)||!/[0-9]/.test(b.password))fail(400,'Crie uma senha com 12 a 128 caracteres, letras e números.');
 if(!Number.isFinite(user.auth_time)||Math.abs(Date.now()/1000-user.auth_time)>300)fail(401,'Entre novamente com a senha temporária para continuar.');
 await auth.updateUser(user.uid,{password:b.password});await auth.revokeRefreshTokens(user.uid);
 await db.runTransaction(async tx=>{const member=db.collection('commercialOperators').doc(user.uid),cat=db.collection('commercialPrivate').doc('catalog'),[m,c]=await Promise.all([tx.get(member),tx.get(cat)]);if(!m.exists||m.data().enabled!==true)fail(403,'Acesso comercial indisponível.');const at=new Date().toISOString(),event={at,actorUid:user.uid,actorName:m.data().name||user.name||'Usuário comercial',actorEmail:user.email||'',message:'Concluiu a troca obrigatória de senha do primeiro acesso comercial',changes:[]};tx.update(member,{mustChangePassword:false,passwordChangedAt:at});tx.create(db.collection('commercialAudit').doc(),event);if(c.exists)tx.update(cat,{revision:(c.data().revision||0)+1,history:[event,...(c.data().history||[])].slice(0,100)});});return {ok:true};
}
export async function overviewUsage(db){
 const c=await db.collection('commercialPrivate').doc('catalog').get(),institutions=c.data()?.institutions||[],counts=[];
 for(let n=0;n<institutions.length;n+=10)counts.push(...await Promise.all(institutions.slice(n,n+10).map(async i=>({id:i.id,students:(await db.collection('academicInstitutions').doc(i.id).collection('students').count().get()).data().count}))));
 return {counts,checkedAt:new Date().toISOString()};
}

export async function listOperators(db,user,env){if(user.uid!==env.COMMERCIAL_OWNER_UID)fail(403,'Cadastro de colaboradores exclusivo do proprietário.');const snapshot=await db.collection('commercialOperators').limit(501).get();if(snapshot.docs.length>500)fail(413,'A consulta de colaboradores exige paginação.');return {collaborators:snapshot.docs.map(d=>{const x=d.data();return {uid:d.id,name:x.name,email:x.email,cpf:x.cpf||'',phone:x.phone||'',whatsapp:x.whatsapp||'',position:x.position||'',address:x.address||'',birthDate:x.birthDate||'',registration:x.registration||'Cadastro anterior — sem registro',collaboratorNumber:x.collaboratorNumber||null,enabled:x.enabled===true,accessLevel:x.accessLevel||'full',revision:x.revision||0};}).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'))};}
