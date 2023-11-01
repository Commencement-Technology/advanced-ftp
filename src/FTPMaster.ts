import { AccessOptions, Client } from "./Client"

interface QueuedFTPTask<T = any> {
    promise: (client: Client) => Promise<T>
    resolve: (value: T) => void
    reject: (reason?: any) => void
    stack: string | undefined
}

export class FTPMaster {
    private accessOptions: AccessOptions
    private _maxConnections: number
    private _autoReconnect: boolean
    private queue: QueuedFTPTask[] = []
    private _clients: {client: Client, inUse: boolean | string}[] = []

    constructor(accessOptions: AccessOptions, maxConnections = 1, autoReconnect = true) {
        this.accessOptions = accessOptions
        this._autoReconnect = autoReconnect
        this._maxConnections = maxConnections
        this.maxConnections = maxConnections
    }

    /**
     * clear queue by rejecting all promises
     */
    public clearQueue() {
        for(let i = 0; i < this.queue.length; i++) {
            this.queue[i].reject("Queue cleared")
        }
        this.queue = []
    }

    public get clients(): {client: Client, inUse: boolean | string}[] {
        return this._clients
    }

    private set clients(clients: {client: Client, inUse: boolean | string}[]) {
        this._clients = clients
    }

    public get autoReconnect(): boolean {
        return this._autoReconnect
    }

    public set autoReconnect(autoReconnect: boolean) {
        this._autoReconnect = autoReconnect
        if(autoReconnect) {
            this.connectClients()
        }
    }

    public get maxConnections(): number {
        return this._maxConnections
    }

    public set maxConnections(maxConnections: number) {
        this._maxConnections = maxConnections

        for(let i = 0; i < this.maxConnections; i++) {
            const client = new Client()
            this.clients.push({
                client,
                inUse: false,
            })
        }

        // Sort clients by priority
        this.clients.sort((a, b) => {
            if(a.client.closed) return -2
            if(!a.inUse) return -1
            if(!b.inUse) return 1
            if(b.client.closed) return 2
            return 0
        })

        for(let i = this.maxConnections; i < this.clients.length; i++) {
            this.clients[i].client.close()
        }
        this.clients = this.clients.slice(0, this.maxConnections)
        this.clients.reverse()

        if(this.autoReconnect) {
            this.connectClients()
        }
    }

    public async connectClients() {
        for(let i = 0; i < this.maxConnections; i++) {
            await this.connectClient(this.clients[i].client)
        }
    }

    private async connectClient(client: Client) {
        if(client.closed) {
            await client.access(this.accessOptions)
            client.ftp.socket.on("close", () => {
                if(this.autoReconnect) {
                    this.connectClient(client)
                }
            })
            client.ftp.socket.on("end", () => {
                if(this.autoReconnect) {
                    this.connectClient(client)
                }
            })
            this.try_dequeue()
        }
    }

    public enqueue<T = void>(promise: (client: Client) => Promise<T>, priority = false): Promise<T> {
        const stack = new Error().stack
        return new Promise((resolve, reject) => {
            if(priority) {
                this.queue.unshift({
                    promise,
                    resolve,
                    reject,
                    stack
                })
            } else {
                this.queue.push({
                    promise,
                    resolve,
                    reject,
                    stack
                })
            }
            this.try_dequeue()
        })
    }

    private async try_dequeue(): Promise<boolean> {
        const client = this.clients.find(x => !x.inUse && !x.client.closed)
        if(!client) return false
        
        const item = this.queue.shift()
        if (!item) return false

        client.inUse = item.stack ?? true
        item.promise(client.client).then((value) => {
            item.resolve(value)
        }).catch((err) => {
            item.reject(err)
        }).finally(() => {
            if(client) client.inUse = false
            this.try_dequeue()
        })
        
        return true
    }

}