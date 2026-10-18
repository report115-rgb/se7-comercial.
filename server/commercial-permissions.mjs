import {fail} from './model.mjs';
export const levels=['full','finance','support'];
export function can(user,area){if(user.commercialRole==='owner')return true;const level=user.accessLevel||'full';return area==='read'||level==='full'&&['institutions','maintenance','audit','finance'].includes(area)||level==='finance'&&area==='finance';}
export function requireArea(user,area){if(!can(user,area))fail(403,'Sua função não tem permissão para esta operação.');}
export function visibleCatalog(state,user){if(user.commercialRole==='owner'||(user.accessLevel||'full')==='full')return state;return {...state,history:[],institutions:state.institutions.map(i=>{if(can(user,'finance'))return i;const {billing,...safe}=i;return safe;})};}
