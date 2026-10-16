import {services} from '../server/admin.mjs';
import {createBillingWebhook} from '../server/commercial-billing.mjs';
export default createBillingWebhook({services});
