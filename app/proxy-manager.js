const http = require('http');

class ProxyManager {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    // Create a new session
    createSession(password = '') {
        return new Promise((resolve, reject) => {
            const url = password
                ? `${this.baseUrl}/newsession?pwd=${encodeURIComponent(password)}`
                : `${this.baseUrl}/newsession`;

            const req = http.get(url, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Failed to create session, status: ${res.statusCode}`));
                    return;
                }

                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    const sessionId = data.trim();
                    if (!sessionId) {
                        reject(new Error('Received empty session ID'));
                    } else {
                        resolve(sessionId);
                    }
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Request timeout while creating session'));
            });
        });
    }

    // Check if a session exists
    sessionExists(sessionId) {
        return new Promise((resolve, reject) => {
            const req = http.get(`${this.baseUrl}/sessionexists?id=${encodeURIComponent(sessionId)}`, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Failed to check session, status: ${res.statusCode}`));
                    return;
                }

                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    resolve(data === 'exists');
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Request timeout while checking session'));
            });
        });
    }

    // Edit session settings
    editSession(sessionId, httpProxy = '', enableShuffling = true, password = 'sharkie4life') {
        let url = `${this.baseUrl}/editsession?id=${encodeURIComponent(sessionId)}&enableShuffling=${enableShuffling ? '1' : '0'}`;

        if (httpProxy) {
            url += `&httpProxy=${encodeURIComponent(httpProxy)}`;
        }

        if (password) {
            url += `&pwd=${encodeURIComponent(password)}`;
        }

        return new Promise((resolve, reject) => {
            const req = http.get(url, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Failed to edit session, status: ${res.statusCode}`));
                    return;
                }

                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (data === 'Success') {
                        resolve(true);
                    } else {
                        reject(new Error(`Unexpected response: ${data}`));
                    }
                });
            });

            req.on('error', (err) => {
                reject(err);
            });

            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Request timeout while editing session'));
            });
        });
    }
}

module.exports = ProxyManager;