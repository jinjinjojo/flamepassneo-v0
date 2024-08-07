// @ts-expect-error pure JS lib lmao
import createRammerhead from 'rammerhead/src/server/index.js';

createRammerhead({
    logLevel: 'debug',
    reverseProxy: false,
    disableLocalStorageSync: false,
    disableHttp2: false
});
