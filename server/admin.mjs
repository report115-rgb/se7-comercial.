import {initializeApp,getApps,cert} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
export function services(){
 const projectId=process.env.COMMERCIAL_FIREBASE_PROJECT_ID;
 if(!projectId||projectId==='sistema-escolar-nuvem')throw Object.assign(new Error('Use um projeto Firebase separado para o painel comercial.'),{status:503});
 if(process.env.FIRESTORE_EMULATOR_HOST||process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Object.assign(new Error('Configuração de emulador não permitida nesta implantação.'),{status:503});
 let app=getApps().find(a=>a.name==='commercial');
 if(!app){let credentials;try{credentials=JSON.parse(process.env.COMMERCIAL_SERVICE_ACCOUNT_JSON||'');}catch{throw Object.assign(new Error('Configure a credencial administrativa do painel comercial.'),{status:503});}if(credentials.project_id!==projectId)throw Object.assign(new Error('A credencial e o projeto comercial não correspondem.'),{status:503});app=initializeApp({credential:cert(credentials),projectId},'commercial');}
 const db=getFirestore(app);return {auth:getAuth(app),db};
}
