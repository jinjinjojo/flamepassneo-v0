import rammerheadServer from "./src/server.js";

function createRammerhead(options: { reverseProxy?: boolean }) {
    if (options.reverseProxy) {
        return rammerheadServer({ reverseProxy: true });
    } else {
        return rammerheadServer({ reverseProxy: false });
    }
}

export { createRammerhead, createRammerhead as default };
