// ==UserScript==
// @name         Miner for ABCC
// @namespace    https://abcc.com/
// @require      http://cdn.bootcss.com/jquery/3.2.1/jquery.min.js
// @require      https://cdn.bootcss.com/decimal.js/10.0.1/decimal.js
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @version      0.1
// @description  try to take over the world!
// @author       You
// @include      https://abcc.com/markets/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // max bid price and min ask price to make order safely
    let max_min_prices = [450, 400];
    let precision = [4, 2];
    let rebalance_threshold = [1, 1000];
    let order_place_rate_per_minute = "3";
    let max_trade_percent_for_funds = 0.9;
    let minimum_order_amount = 0.01;
    let trading_pair = "ethusdt";

    // Account
    let Account = {
        balance: 0,
        pattern: "",
        refresh: function() {
            let balance = $(this.pattern).text().trim().split("：")[1];
            this.balance = balance;
        },
        active_balance: function() {
            return this.balance * max_trade_percent_for_funds;
        }
    }

    Account.hold_account = function() {
        let account = Object.create(Account);
        account.pattern = "div.order-form .balance:first";
        account.refresh();

        return account;
    }

    Account.expect_account = function() {
        let account = Object.create(Account);
        account.pattern = "div.order-form .balance:last";
        account.refresh();

        return account;
    }

    // Ticker
    let Ticker = {
        base_unit: "",
        quote_unit: "",
        price: 0,
        name: function() {
            return this.base_unit.toLowerCase() + "" + this.quote_unit.toLowerCase();
        },
        refresh: function() {
            let base_unit = $("span.current-currency").text();
            let quote_unit = $("span.echange-currency").text();
            let price = $("div.price-wrap p.fade span:first").text();

            this.base_unit = base_unit;
            this.quote_unit = quote_unit.substring(1);
            if (price.length > 0) {
                this.price = price;
            }
        }
    };

    // OrderBook
    let OrderBook = {
        minimum_ask_price: 0,
        maximum_bid_price: 0,
        refresh: function() {
            let minimum_ask_price = $(".ask-table tr:last td:first").text();
            let maximum_bid_price = $(".bid-table tr:first td:first").text();

            this.minimum_ask_price = minimum_ask_price;
            this.maximum_bid_price = maximum_bid_price;
        },
        random_price: function() {
            let price = parseFloat(this.minimum_ask_price) - parseFloat(this.minimum_ask_price - this.maximum_bid_price) / parseFloat(2);
            if (price > max_min_prices[0] || price < max_min_prices[1]) {
                return [0, 0];
            }

            price = new Decimal(price).toFixed(precision[1]);
            console.log("price: " + price);
            if ((price === this.minimum_ask_price + "") || (price === this.maximum_bid_price + "")) {
                return [this.minimum_ask_price, this.maximum_bid_price];
            } else {
                return [price, price];
            }
        },
        desc: function() {
            return "minimum_ask_price: " + this.minimum_ask_price + ", maximum_bid_price: " + this.maximum_bid_price;
        }
    };

    let ticker = Object.create(Ticker);
    let orderbook = Object.create(OrderBook);
    let hold_account = Account.hold_account();
    let expect_account = Account.expect_account();

    // Miner
    let Miner = {
        started_at: 0,
        last_placed_at: 0,
        period_placed_count: 0,
        total_placed_count: 0,
        check_account: function() {

            if (hold_account.balance < rebalance_threshold[1] || expect_account.balance < rebalance_threshold[0]) {
                return false;
            } else {
                return true;
            }
        },
        rebalance_account: function() {
            let hold_balance = hold_account.balance;
            let expect_balance = expect_account.balance;

            let ask_or_bid = "ask";
            if (expect_balance < rebalance_threshold[0]) {
                ask_or_bid = "bid";
            }

            let price = ask_or_bid === "ask" ? orderbook.maximum_bid_price : orderbook.minimum_ask_price;
            price = ask_or_bid === "ask" ? parseFloat(price) - 0.1 : parseFloat(price) + 0.1;
            let volume = ask_or_bid === "ask" ? (parseFloat(expect_balance) / parseFloat(2)) : (parseFloat(hold_balance) / parseFloat(2) / parseFloat(price));
            volume = new Decimal(volume).toFixed(precision[0]);

            this.logger("Will send rebalance order.");
            this.send_order(ask_or_bid, price, volume);
        },
        init: function() {
            this.started_at = new Date().getTime();
            ticker.refresh();
            orderbook.refresh();

            // trading_pair = ticker.base_unit.toLowerCase() + "" + ticker.quote_unit.toLowerCase();

            this.logger(ticker.base_unit + "/" + ticker.quote_unit);
            this.logger("orderbook: " + orderbook.desc());
            this.logger("hold account: " + hold_account.balance);
            this.logger("expect account: " + expect_account.balance);
        },
        is_good_time: function() {
            if (this.last_placed_at < 1 || this.period_placed_count < 1) {
                return true;
            }

            let second = new Date().getSeconds();
            let last_time = new Date();
            last_time.setTime(this.last_placed_at);
            let last_second = this.last_placed_at === 0 ? 0 : last_time.getSeconds();
            let rate = Math.round(60 / (parseInt(order_place_rate_per_minute)));

            let good_time = Math.abs(second - last_second) > rate ? true : false;
            return good_time
        },
        count: function() {
            this.total_placed_count += 1;

            let t = new Date()
            let current_minute = t.getMinutes();

            if (this.last_placed_at < 1) {
                this.period_placed_count = 1;
            } else {
                let last_time = new Date();
                last_time.setTime(this.last_placed_at);
                let last_minute = this.last_placed_at === 0 ? 0 : last_time.getMinutes();

                if (current_minute !== last_minute) {
                    this.period_placed_count = 1;
                } else {
                    this.period_placed_count += 1
                }
            }

            this.last_placed_at = t.getTime();
        },
        send_order: function(type, price, volume) {
            let total = parseFloat(price) * parseFloat(volume);
            if (total < minimum_order_amount) {
                return;
            }

            const data = { 'utf8': '✓' };
            data[`order_${type}[ord_type]`] = 'limit';
            data[`order_${type}[price]`] = price;
            data[`order_${type}[origin_volume]`] = volume;
            data[`order_${type}[total]`] = total;
            data[`order_${type}[percent]`] = 0;
            this.count();

            axios({
                method: 'post',
                url: `/markets/${trading_pair}/order_${type}s`,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRF-Token': document.querySelector('meta[name=csrf-token]').content,
                    'X-XSRF-TOKEN': decodeURIComponent(document.cookie.split('; ').filter(v => v.startsWith('XSRF-TOKEN'))[0].split('=')[1]),
                },
                data: data
            }).then((r) => {
                this.logger("placed order: " + r.data.message + ", price: " + price + ", volume:" + volume);
            }).catch((error) => {
                this.clear_orders();
            });
        },
        clear_orders: function() {
            axios({
                method: 'post',
                url: '/markets/clear_all_waiting_orders',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-CSRF-Token': document.querySelector('meta[name=csrf-token]').content,
                    'X-XSRF-TOKEN': decodeURIComponent(document.cookie.split('; ').filter(v => v.startsWith('XSRF-TOKEN'))[0].split('=')[1]),
                }
            }).then((r) => {
                this.logger("clearing the orders for errors.");
            });
        },
        self_trade: function(orderbook) {
            let prices = orderbook.random_price();
            let ask_price = prices[0];
            let bid_price = prices[1];
            if (ask_price === 0 || isNaN(ask_price) || bid_price === 0 || isNaN(bid_price)) {
                this.logger("Wrong price: " + ask_price + ", bid_price: " + bid_price + ", orderbook: " + orderbook.desc());
                return;
            }

            hold_account.refresh();
            expect_account.refresh();

            if (!this.check_account()) {
                this.rebalance_account();
                return;
            }

            if (hold_account.balance <= 0 || expect_account.balance <=0) {
                this.logger("Can't place order with ZERO balance.");
                return;
            }

            let expect_funds = expect_account.active_balance() * ask_price;
            let active_hold_balance = hold_account.active_balance();
            let active_expect_balance = expect_account.active_balance();
            let volume = active_hold_balance > expect_funds ? active_expect_balance : active_hold_balance / bid_price;

            if (volume !== '' && !isNaN(volume)) {
                volume = new Decimal(volume).toFixed(precision[0]);
                this.send_order('ask', ask_price, volume);
                this.send_order('bid', bid_price, volume);

                hold_account.refresh();
                expect_account.refresh();
            } else {
                this.logger("Wrong volume: " + volume);
            }
        },
        logger: function(log) {
            let t = new Date();
            console.log(t.getHours() + ":" + t.getMinutes() + ":" + t.getSeconds() + " - " + log);
        }
    }


    let miner = Object.create(Miner);
    miner.init();

    if (ticker.name() === trading_pair) {
        let place_timer = setInterval(function() {
            if (miner.is_good_time()) {
                miner.self_trade(orderbook);
            }
        }, 1000);
    } else {
        miner.logger("Not support for this pair: " + ticker.name() + ", support pairs: " + trading_pair);
    }

    let ticker_timer = setInterval(function() {
        ticker.refresh();
        orderbook.refresh();

        // miner.logger("orderbook: " + orderbook.desc());
    }, 1000);
})();