const http = require('http');

class ProxyManager {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }

    // Create a new session
    createSession() {
        return new Promise((resolve, reject) => {
            http.get(`${this.baseUrl}/newsession`, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Failed to create session, status: ${res.statusCode}`));
                    return;
                }

                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    resolve(data.trim());
                });
            }).on('error', (err) => {
                reject(err);
            });
        });
    }

    // Check if a session exists
    sessionExists(sessionId) {
        return new Promise((resolve, reject) => {
            http.get(`${this.baseUrl}/sessionexists?id=${encodeURIComponent(sessionId)}`, (res) => {
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
            }).on('error', (err) => {
                reject(err);
            });
        });
    }

    // Edit session settings
    editSession(sessionId, options = {}) {
        const { enableShuffling = true, httpProxy = '' } = options;

        let url = `${this.baseUrl}/editsession?id=${encodeURIComponent(sessionId)}&enableShuffling=${enableShuffling ? '1' : '0'}`;
        if (httpProxy) {
            url += `&httpProxy=${encodeURIComponent(httpProxy)}`;
        }

        return new Promise((resolve, reject) => {
            http.get(url, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Failed to edit session, status: ${res.statusCode}`));
                    return;
                }

                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    resolve(data === 'Success');
                });
            }).on('error', (err) => {
                reject(err);
            });
        });
    }
}

module.exports = ProxyManager;