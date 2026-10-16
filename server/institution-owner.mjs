import {randomBytes} from 'node:crypto';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const valid=v=>typeof v==='string'&&/^[-a-zA-Z0-9_:]{1,128}$/.test(v);
export async function createInstitutionOwner(db,auth,b,actor){
 if(!valid(b.institutionId))fail(400,'Instituição inválida.');
 const catalog=await db.collection('commercialPrivate').doc('catalog').get();
 const institution=catalog.data()?.institutions?.find(i=>i.id===b.institutionId);
 if(!institution||institution.own)fail(400,'Selecione uma instituição cliente para preparar o acesso.');
 const email=String(institution.contactEmail||'').trim().toLowerCase(),name=String(institution.contactName||'').trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||name.length<2||name.length>100)fail(400,'Preencha nome e e-mail do proprietário.');
 const ownerRef=db.collection('academicInstitutionOwners').doc(b.institutionId);
 if((await ownerRef.get()).exists)fail(409,'Esta instituição já tem um proprietário preparado.');
 let existing;try{existing=await auth.getUserByEmail(email);}catch(e){if(e.code!=='auth/user-not-found')throw e;}
 if(existing)fail(409,'Este e-mail já possui uma conta. Use um e-mail exclusivo para o Master desta instituição; nenhuma senha existente foi alterada.');
 const password='Se7!'+randomBytes(15).toString('base64url');
 const account=await auth.createUser({email,displayName:name,password,disabled:false});
 try{await db.runTransaction(async tx=>{
 const current=await tx.get(ownerRef);if(current.exists)fail(409,'O proprietário foi preparado em outra janela.');
 const at=new Date().toISOString();
 tx.create(ownerRef,{uid:account.uid,email,name,createdAt:at,createdBy:actor.uid});
 tx.create(db.collection('academicUsers').doc(account.uid),{institutionId:b.institutionId,role:'master',name,email,enabled:true,mustChangePassword:true,createdAt:at});
 tx.create(db.collection('commercialAudit').doc(),{at,actor:actor.email||actor.uid,actorUid:actor.uid,actorName:actor.name||'Administrador comercial',actorEmail:actor.email||'',message:'Preparou acesso Master da instituição '+institution.name+' para '+email});
 });}catch(e){await auth.deleteUser(account.uid);throw e;}
 return {email,name,temporaryPassword:password};
}
