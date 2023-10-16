import { AccessOptions, Client } from "./Client";

interface QueuedFTPTask<T = any> {
    promise: (client: Client) => Promise<T>;
    resolve: (value: T) => void;
    reject: (reason?: any) => void;
}

export class FTPMaster {
    private accessOptions: AccessOptions;
    private maxConnections: number;
    private queue: QueuedFTPTask[] = [];
    public readonly clients: {client: Client, inUse: boolean}[] = [];

    constructor(accessOptions: AccessOptions, maxConnections: number = 1) {
        this.accessOptions = accessOptions;
        this.maxConnections = maxConnections;

        for(var i = 0; i < this.maxConnections; i++) {
            var client = new Client();
            this.clients.push({
                client,
                inUse: false,
            });
        }
    }

    public async connectClients() {
        for(var i = 0; i < this.maxConnections; i++) {
            await this.connectClient(this.clients[i].client);
        }
    }

    private async connectClient(client: Client) {
        if(client.closed) {
            await client.access(this.accessOptions);
            client.ftp.socket.on("close", () => {
                this.connectClient(client)
            })
            client.ftp.socket.on("end", () => {
                this.connectClient(client)
            })
        }
    }

    public enqueue<T = void>(promise: (client: Client) => Promise<T>, priority: boolean = false): Promise<T> {
        return new Promise((resolve, reject) => {
            if(priority) {
                this.queue.unshift({
                    promise,
                    resolve,
                    reject,
                });
            } else {
                this.queue.push({
                    promise,
                    resolve,
                    reject,
                });
            }
            this.try_dequeue();
        });
    }

    public async try_dequeue(): Promise<boolean> {
        var client = this.clients.find(x => !x.inUse);
        if(!client) return false;
        
        const item = this.queue.shift();
        if (!item) return false;

        client.inUse = true;
        item.promise(client.client).then((value) => {
            item.resolve(value);
        }).catch((err) => {
            item.reject(err);
        }).finally(() => {
            client!.inUse = false;
            this.try_dequeue()
        });
        
        return true;
    }

}