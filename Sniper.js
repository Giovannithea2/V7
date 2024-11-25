const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
require('dotenv').config();

class Sniper {
    constructor(config) {
        this.baseToken = config.baseToken;
        this.targetToken = config.targetToken;
        this.buyAmount = config.buyAmount;
        this.sellTargetPercentage = config.sellTargetPrice;
        this.tokenData = config.tokenData;
        this.connection = new Connection(process.env.SOLANA_WS_URL, 'confirmed');
        this.K = Number(config.tokenData.K) / 1000000000000000;
        this.V = parseFloat(config.tokenData.V);
        this.calculatedSellPrice = this.V * (1 + (this.sellTargetPercentage / 100));
        this.vaultSubscriptionId = null;
        this.walletPublicKey = new PublicKey(process.env.WALLET_PUBLIC_KEY);
        this.minimumSolBalance = 0.1;
    }

    setBuyAmount(amount) {
        this.buyAmount = amount;
    }

    setSellTargetPrice(percentage) {
        this.sellTargetPercentage = percentage;
        this.calculatedSellPrice = this.V * (1 + (percentage / 100));
    }

    async watchPrice() {
        console.log(`Watching price for target token: ${this.targetToken}`);
        console.log(`Initial price (V): ${this.V}`);
        console.log(`Target sell price (${this.sellTargetPercentage}% increase): ${this.calculatedSellPrice}`);

        const intervalId = setInterval(async () => {
            const currentPrice = await this.getCurrentPrice();
            console.log(`Current price of ${this.targetToken}: ${currentPrice}`);
            if (currentPrice >= this.calculatedSellPrice) {
                await this.sellToken();
                clearInterval(intervalId);
            }
        }, 60000);
    }

    async getCurrentPrice() {
        // Fetch the current liquidity pool balance from pcVault
        const currentBalance = await this.getLiquidityBalance(); // Replace with the actual logic
        return this.calculatePrice(currentBalance);
    }

    calculatePrice(currentBalance) {
        const X = this.K / currentBalance;
        const price = currentBalance / X;
        return price;
    }

    async getLiquidityBalance() {
        const solVault = new PublicKey(this.tokenData.solVault);
        const accountInfo = await this.connection.getAccountInfo(solVault);
        if (accountInfo) {
            const balance = accountInfo.lamports / 10 ** 9;
            return balance;
        }
        throw new Error(`Unable to fetch liquidity balance for solVault ${this.tokenData.solVault}`);
    }

    async checkWalletBalance() {
        try {
            const balance = await this.connection.getBalance(this.walletPublicKey);
            const solBalance = balance / LAMPORTS_PER_SOL;
            console.log(`Current wallet balance: ${solBalance} SOL`);

            if (solBalance < this.buyAmount + this.minimumSolBalance) {
                throw new Error(`Insufficient SOL balance. Required: ${this.buyAmount + this.minimumSolBalance} SOL, Current: ${solBalance} SOL`);
            }
            return true;
        } catch (error) {
            console.error('Error checking wallet balance:', error.message);
            return false;
        }
    }

    async buyToken() {
        try {
            console.log(`Attempting to buy ${this.buyAmount} of target token: ${this.targetToken}`);
            
            // Check wallet balance before proceeding
            const hasBalance = await this.checkWalletBalance();
            if (!hasBalance) {
                console.error('Buy order cancelled due to insufficient balance');
                return false;
            }

            // Log transaction details for debugging
            console.log('Transaction details:', {
                baseToken: this.baseToken,
                targetToken: this.targetToken,
                amount: this.buyAmount,
                tokenData: {
                    ammId: this.tokenData.ammId,
                    solVault: this.tokenData.solVault,
                    tokenVault: this.tokenData.tokenVault
                }
            });
            
            await swapTokens({
                userSource: this.baseToken,
                userDestination: this.targetToken,
                amountSpecified: this.buyAmount,
                swapBaseIn: true,
                ammKeys: {
                    ammId: this.tokenData.ammId,
                    solVault: this.tokenData.solVault,
                    tokenVault: this.tokenData.tokenVault,
                    // Add other required AMM keys
                }
            });
            
            console.log(`Successfully bought ${this.buyAmount} of ${this.targetToken}`);
            return true;
        } catch (error) {
            console.error('Error executing buy order:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                tokenData: this.tokenData
            });
            return false;
        }
    }

    async sellToken() {
        console.log(`Selling target token: ${this.targetToken}`);
        
        await swapTokens({
            // ... other parameters ...
            userSource: this.targetToken,  // Source token (the one we're selling)
            userDestination: this.baseToken,  // Destination token (e.g., SOL)
            amountSpecified: this.buyAmount,
            swapBaseIn: false,  // Indicates this is a sell order
        });
        
        console.log(`Successfully sold ${this.targetToken}`);
    }

    async subscribeToVault() {
        const solVault = new PublicKey(this.tokenData.solVault);
        this.vaultSubscriptionId = this.connection.onAccountChange(solVault, (accountInfo) => {
            const balance = accountInfo.lamports / 10 ** 9;
            console.log(`Updated balance for solVault ${this.tokenData.solVault}: ${balance}`);
            const price = this.calculatePrice(balance);
            console.log(`Calculated price based on updated balance: ${price}`);

            if (price >= this.calculatedSellPrice) {
                this.sellToken()
                    .then(() => this.unsubscribeFromVault())
                    .catch(error => console.error('Error during sale:', error));
            }
        });
        console.log(`Subscribed to account changes for solVault ${this.tokenData.solVault}`);
    }

    async unsubscribeFromVault() {
        if (this.vaultSubscriptionId) {
            try {
                await this.connection.removeAccountChangeListener(this.vaultSubscriptionId);
                console.log(`Unsubscribed from vault ${this.tokenData.solVault}`);
                this.vaultSubscriptionId = null;
            } catch (error) {
                console.error('Error unsubscribing from vault:', error);
            }
        }
    }
}

module.exports = Sniper;
