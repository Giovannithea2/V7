const Sniper = require('./Sniper');
require('dotenv').config(); // Load environment variables

class SniperManager {
    constructor() {
        this.snipers = [];
        this.failedTransactions = [];
    }

    async addSniper(config) {
        try {
            console.log('New LP detected, initializing sniper with config:', {
                targetToken: config.targetToken,
                buyAmount: config.buyAmount,
                sellTargetPrice: config.sellTargetPrice
            });

            const sniper = new Sniper(config);
            this.snipers.push(sniper);

            // Check wallet balance before attempting to buy
            const hasBalance = await sniper.checkWalletBalance();
            if (!hasBalance) {
                this.failedTransactions.push({
                    timestamp: new Date(),
                    token: config.targetToken,
                    reason: 'Insufficient balance',
                    config: config
                });
                return;
            }

            const buySuccess = await sniper.buyToken();
            if (buySuccess) {
                console.log('Token bought successfully. Starting price monitoring.');
                
                await Promise.all([
                    sniper.watchPrice().catch(err => {
                        console.error('Error watching price:', err);
                    }),
                    sniper.subscribeToVault().catch(err => {
                        console.error('Error subscribing to vault:', err);
                    })
                ]);
            } else {
                console.error('Failed to buy token, removing sniper');
                this.failedTransactions.push({
                    timestamp: new Date(),
                    token: config.targetToken,
                    reason: 'Buy transaction failed',
                    config: config
                });
                // Remove the failed sniper from the array
                const index = this.snipers.indexOf(sniper);
                if (index > -1) {
                    this.snipers.splice(index, 1);
                }
            }
        } catch (error) {
            console.error('Error in addSniper:', error);
            this.failedTransactions.push({
                timestamp: new Date(),
                token: config.targetToken,
                reason: error.message,
                config: config
            });
        }
    }

    getFailedTransactions() {
        return this.failedTransactions;
    }

    setBuyAmount(index, amount) {
        if (this.snipers[index]) {
            this.snipers[index].setBuyAmount(amount);
            console.log(`Buy amount set to ${amount} for sniper at index ${index}`);
        } else {
            console.error('Sniper not found at index:', index);
        }
    }

    setSellTargetPrice(index, price) {
        if (this.snipers[index]) {
            this.snipers[index].setSellTargetPrice(price);
            console.log(`Sell target price set to ${price} for sniper at index ${index}`);
        } else {
            console.error('Sniper not found at index:', index);
        }
    }

    async init() {
        console.log('Sniper Manager initialized');
    }
}

module.exports = new SniperManager();
