import { EventEmitter } from "stream"
import { AccessOptions, Client } from "./Client"

interface QueuedFTPTask<T = any> {
    promise: (client: Client) => Promise<T>
    resolve: (value: T) => void
    reject: (reason?: any) => void
    stack: string | undefined
    abortSignal: AbortSignal
}

type EnqueueResult<T> = Promise<T> & {abort: () => void}

export class FTPMaster extends EventEmitter {
    private accessOptions: AccessOptions
    private _maxConnections: number
    private _autoReconnect: boolean
    private _queue: QueuedFTPTask[] = []
    private _clients: {client: Client, inUse: boolean | string}[] = []

    constructor(accessOptions: AccessOptions, maxConnections = 1, autoReconnect = true) {
        super()
        this.accessOptions = accessOptions
        this._autoReconnect = autoReconnect
        this._maxConnections = maxConnections
        this.maxConnections = maxConnections
    }

    /**
     * clear queue by rejecting all promises
     */
    public clearQueue() {
        for(let i = 0; i < this._queue.length; i++) {
            this._queue[i].reject("Queue cleared")
        }
        this._queue = []
    }

    public get queue(): QueuedFTPTask[] {
        return this._queue
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
                inUse: true,
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
            this.connectClients().catch((err) => {
                this.emit("error", err)
            })
        }
    }

    public async connectClients() {
        for(let i = 0; i < this.maxConnections; i++) {
            await this.connectClient(this.clients[i].client)
        }
    }

    private async connectClient(client: Client) {
        if(client.closed) {
            this.clients.find(x => x.client === client)!.inUse = true
            await client.access(this.accessOptions)
            this.clients.find(x => x.client === client)!.inUse = false
            client.ftp.socket.on("close", () => {
                if(this.autoReconnect) {
                    this.connectClient(client).catch((err) => {
                        this.emit("error", err)
                    })
                }
            })
            client.ftp.socket.on("end", () => {
                if(this.autoReconnect) {
                    this.connectClient(client).catch((err) => {
                        this.emit("error", err)
                    })
                }
            })
            this.try_dequeue()
        }
    }

    public enqueue<T = void>(promise: (client: Client) => Promise<T>, priority = false): EnqueueResult<T> {
        const stack = new Error().stack
        let abortController = new AbortController()
        let retpromise = new Promise<T>((resolve, reject) => {
            let task = {
                promise,
                resolve,
                reject,
                stack,
                abortSignal: abortController.signal
            }
            abortController.signal.addEventListener("abort", () => {
                task.reject(new AbortError("Aborted"))
                if(this._queue.includes(task)) {
                    this._queue.splice(this._queue.indexOf(task), 1)
                }
            })
            if(priority) {
                this._queue.unshift(task)
            } else {
                this._queue.push(task)
            }
            this.try_dequeue()
        }) as EnqueueResult<T>
        retpromise.abort = () => {
            abortController.abort()
        }
        return retpromise
    }

    private async try_dequeue(): Promise<boolean> {
        const client = this.clients.find(x => !x.inUse && !x.client.closed)
        if(!client) return false
        
        const item = this._queue.shift()
        if (!item) return false

        client.inUse = item.stack ?? true
        item.abortSignal.addEventListener("abort", () => {
            //kill data connection
            client.client.ftp.closeSocket(client.client.ftp.dataSocket)
        })

        item.promise(client.client).then((value) => {
            if(item.abortSignal.aborted) {
                item.reject(new AbortError("Aborted"))
                return
            }
            item.resolve(value)
        }).catch((err) => {
            if(item.abortSignal.aborted) {
                item.reject(new AbortError("Aborted"))
                return
            }
            item.reject(err)
        }).finally(() => {
            if(client) client.inUse = false
            this.try_dequeue()
        })
        
        return true
    }

}

export class AbortError extends Error {
    constructor(message?: string) {
        super(message)
        this.name = "AbortError"
    }
}