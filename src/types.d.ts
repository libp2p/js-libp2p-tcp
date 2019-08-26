/**
 * @module js-libp2p-tcp/get-multiaddr
 */
declare module "js-libp2p-tcp/get-multiaddr" {
    /**
     * @type {function}
     * @param {*} socket
     * @returns {*}
     */
    function getMultiAddr(socket: any): any;
}

/**
 * @module js-libp2p-tcp
 */
declare module "js-libp2p-tcp" {
    /**
     * @class
     */
    class TCP {
        /**
         *
         * @param {*} ma
         * @param {object} options
         * @param {function} callback
         */
        dial(ma: any, options: any, callback: (...params: any[]) => any): void;
        /**
         *
         * @param {object} options
         * @param {function} handler
         */
        createListener(options: any, handler: (...params: any[]) => any): void;
        /**
         *
         * @param {Array<*>|*} multiaddrs
         */
        filter(multiaddrs: any[] | any): void;
    }
}

/**
 * @module js-libp2p-tcp/listener
 */
declare module "js-libp2p-tcp/listener" {
    /**
     * @type {function}
     * @param {function} handler
     * @returns {*}
     */
    function listener(handler: (...params: any[]) => any): any;
}

