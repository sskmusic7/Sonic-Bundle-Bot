const config = require('../config');
const { logger, logProfit } = require('./logger');

class ProfitCalculator {
  constructor() {
    this.fees = config.fees;
    this.profit = config.profit;
  }

  calculate(item) {
    const platform = item.platform.toLowerCase().split(' ')[0]; // Extract platform name
    const buyPrice = item.priceNumeric || parseFloat(item.price.replace(/[^0-9.]/g, ''));

    // Calculate fees based on platform
    const fees = this.calculateFees(platform, buyPrice);

    // Estimate resale value based on historical data and platform
    const suggestedPrice = this.estimateResaleValue(item, buyPrice);

    // Calculate gross profit
    const grossProfit = suggestedPrice - buyPrice;

    // Calculate net profit after fees
    const netProfit = grossProfit - fees.total;

    // Calculate margin percentage
    const margin = buyPrice > 0 ? ((netProfit / buyPrice) * 100).toFixed(1) : 0;

    // Check if profitable
    const profitable = netProfit > 0 && parseFloat(margin) >= this.profit.minProfitMargin;

    const analysis = {
      buyPrice,
      suggestedPrice,
      grossProfit,
      fees,
      netProfit,
      margin: parseFloat(margin),
      profitable,
      meetsMinimumMargin: parseFloat(margin) >= this.profit.minProfitMargin,
      meetsTargetMargin: parseFloat(margin) >= this.profit.targetProfitMargin
    };

    // Log the profit analysis
    logProfit(item, analysis);

    return analysis;
  }

  calculateFees(platform, price) {
    let platformName = platform.toLowerCase();

    // Handle variations of platform names
    if (platformName.includes('ebay')) platformName = 'ebay';
    else if (platformName.includes('mercari')) platformName = 'mercari';
    else if (platformName.includes('offer')) platformName = 'offerup';
    else if (platformName.includes('facebook')) platformName = 'facebook';
    else if (platformName.includes('poshmark')) platformName = 'poshmark';
    else if (platformName.includes('depop')) platformName = 'depop';
    else if (platformName.includes('etsy')) platformName = 'etsy';
    else if (platformName.includes('goodwill')) platformName = 'shopgoodwill';
    else platformName = 'default';

    const platformFees = this.fees[platformName] || { percentage: 10, fixed: 0 };

    // Calculate percentage-based fee
    const percentageFee = (price * platformFees.percentage) / 100;

    // Calculate shipping fees if applicable
    let shippingFee = 0;
    if (platformFees.shippingIncluded && this.profit.includeShippingCost) {
      shippingFee = this.profit.estimatedShippingCost;
    } else if (platformFees.shippingPercentage) {
      shippingFee = (price * platformFees.shippingPercentage) / 100;
    }

    // Calculate listing fee (Etsy)
    let listingFee = platformFees.listingFee || 0;

    // Calculate Poshmark flat fee (for items under $15)
    let poshmarkFlatFee = 0;
    if (platformName === 'poshmark' && price < 15) {
      poshmarkFlatFee = platformFees.fixed;
    }

    // Total fees
    const total = percentageFee + platformFees.fixed + shippingFee + listingFee + poshmarkFlatFee;

    return {
      percentage: platformFees.percentage,
      percentageFee: percentageFee.toFixed(2),
      fixed: platformFees.fixed,
      shippingFee: shippingFee.toFixed(2),
      listingFee: listingFee.toFixed(2),
      poshmarkFlatFee: poshmarkFlatFee.toFixed(2),
      total: total.toFixed(2)
    };
  }

  calculateBundleFees(items, resaleValue) {
    // Calculate total fees for selling a bundle
    // Assume bundle is sold on eBay (most common for collectibles)

    const ebayFees = this.fees.ebay;
    const percentageFee = (resaleValue * ebayFees.percentage) / 100;
    const shippingFee = this.profit.estimatedShippingCost;

    const total = percentageFee + ebayFees.fixed + shippingFee;

    return {
      platform: 'eBay',
      percentage: ebayFees.percentage,
      percentageFee: percentageFee.toFixed(2),
      fixed: ebayFees.fixed,
      shippingFee: shippingFee.toFixed(2),
      total: total.toFixed(2)
    };
  }

  estimateResaleValue(item, buyPrice) {
    // Base resale calculation with different multipliers per platform
    const platform = item.platform.toLowerCase();

    let baseMultiplier = 1.5; // Default 50% markup

    // Platform-specific multipliers based on typical buyer behavior
    if (platform.includes('ebay')) {
      baseMultiplier = 1.6; // eBay buyers pay more for collectibles
    } else if (platform.includes('mercari')) {
      baseMultiplier = 1.4; // Mercari is more competitive
    } else if (platform.includes('offerup')) {
      baseMultiplier = 1.3; // OfferUp expects lower prices
    } else if (platform.includes('facebook')) {
      baseMultiplier = 1.5; // Facebook is middle ground
    } else if (platform.includes('poshmark')) {
      baseMultiplier = 1.4; // Poshmark focuses on fashion, less collectibles
    } else if (platform.includes('depop')) {
      baseMultiplier = 1.35; // Depop is youth-focused
    } else if (platform.includes('etsy')) {
      baseMultiplier = 1.5; // Etsy can be premium pricing
    } else if (platform.includes('goodwill')) {
      baseMultiplier = 1.8; // ShopGoodwill deals are often undervalued
    }

    // Adjust for specific item keywords
    const title = item.title.toLowerCase();
    if (title.includes('rare') || title.includes('limited') || title.includes('exclusive')) {
      baseMultiplier += 0.3; // Rare items get higher markup
    }
    if (title.includes('bundle') || title.includes('lot')) {
      baseMultiplier += 0.2; // Bundles are undervalued
    }
    if (title.includes('vintage') || title.includes('retro')) {
      baseMultiplier += 0.25; // Vintage has premium
    }
    if (title.includes('sealed') || title.includes('new') || title.includes('mint')) {
      baseMultiplier += 0.2; // Condition premium
    }
    if (title.includes('damaged') || title.includes('broken') || title.includes('missing')) {
      baseMultiplier -= 0.4; // Damaged items need lower markup
    }

    // Calculate suggested price
    let suggestedPrice = buyPrice * baseMultiplier;

    // Round to nearest .99 for retail pricing
    suggestedPrice = Math.ceil(suggestedPrice) - 0.01;

    // Ensure minimum price
    if (suggestedPrice < buyPrice + 5) {
      suggestedPrice = buyPrice + 5;
    }

    return parseFloat(suggestedPrice.toFixed(2));
  }

  calculateBreakEven(item) {
    // Calculate the minimum resale price to break even
    const buyPrice = item.priceNumeric || parseFloat(item.price.replace(/[^0-9.]/g, ''));
    const platform = item.platform.toLowerCase().split(' ')[0];

    const fees = this.calculateFees(platform, buyPrice);
    const breakEven = buyPrice + parseFloat(fees.total);

    return {
      breakEvenPrice: breakEven.toFixed(2),
      fees: fees.total,
      minProfitMargin: (breakEven * 1.2).toFixed(2) // 20% margin minimum
    };
  }

  analyzeBulk(items) {
    // Analyze multiple items and return ranked list
    const analyses = items.map(item => ({
      item,
      analysis: this.calculate(item)
    }));

    // Filter for profitable items
    const profitableItems = analyses.filter(a => a.analysis.profitable);

    // Sort by net profit (highest first)
    profitableItems.sort((a, b) => b.analysis.netProfit - a.analysis.netProfit);

    // Also sort by margin (alternative ranking)
    const byMargin = [...profitableItems].sort(
      (a, b) => b.analysis.margin - a.analysis.margin
    );

    return {
      totalItems: items.length,
      profitableCount: profitableItems.length,
      byProfit: profitableItems,
      byMargin: byMargin,
      totalPotentialProfit: profitableItems.reduce(
        (sum, a) => sum + a.analysis.netProfit,
        0
      ).toFixed(2),
      avgMargin: profitableItems.length > 0
        ? (profitableItems.reduce((sum, a) => sum + a.analysis.margin, 0) / profitableItems.length).toFixed(1)
        : 0
    };
  }
}

const profitCalculator = new ProfitCalculator();

module.exports = { profitCalculator };
