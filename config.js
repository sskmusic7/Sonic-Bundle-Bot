// config.js - Enhanced configuration file for Autonomous Sonic Bundle Hunter

module.exports = {
  // ==================== TELEGRAM NOTIFICATIONS ====================
  telegram: {
    enabled: true,
    botToken: process.env.TELEGRAM_BOT_TOKEN || '', // Your bot token from BotFather
    chatId: process.env.TELEGRAM_CHAT_ID || '', // Your chat ID to receive alerts
    notifyOnDeal: true, // Send alerts for profitable deals
    notifyOnHighProfit: true, // Send alerts for deals >50% profit
    notifyOnSummary: true, // Send daily/weekly summaries
    alertThreshold: 30, // Minimum profit margin % to trigger alert
  },

  // ==================== SCHEDULING ====================
  scheduling: {
    enabled: true,
    searchIntervalMinutes: 30, // Run searches every 30 minutes
    dailyReportHour: 9, // Send daily summary at 9 AM
    weeklyReportDay: 0, // 0 = Sunday, 1 = Monday, etc.
    weeklyReportHour: 20, // 8 PM Sunday for weekly report
    timezone: 'America/New_York'
  },

  // ==================== DATABASE ====================
  database: {
    type: 'sqlite', // 'sqlite' or 'json'
    path: './data/sonic_tracker.db',
    jsonPath: './data/flip_history.json'
  },

  // ==================== FEE CONFIGURATION ====================
  fees: {
    ebay: {
      percentage: 13, // 13% final value fee
      fixed: 0.30, // Fixed fee
      shippingIncluded: true
    },
    mercari: {
      percentage: 10, // 10% fee
      fixed: 0,
      shippingIncluded: false
    },
    offerup: {
      percentage: 0, // Free for local pickup
      shippingPercentage: 12.9, // For shipped items
      fixed: 1.99
    },
    facebook: {
      percentage: 0, // Free on Facebook Marketplace
      fixed: 0
    },
    poshmark: {
      percentage: 20, // Poshmark fee
      fixed: 2.95, // Flat fee under $15
    },
    depop: {
      percentage: 10, // Depop fee
      fixed: 0
    },
    etsy: {
      percentage: 6.5, // Etsy fee
      listingFee: 0.20,
      fixed: 0
    },
    shopgoodwill: {
      percentage: 0, // No buyer fee
      fixed: 0
    }
  },

  // ==================== PROFIT SETTINGS ====================
  profit: {
    minProfitMargin: 20, // Minimum profit margin %
    targetProfitMargin: 50, // Target profit margin %
    includeFeesInCalculation: true,
    includeShippingCost: true,
    estimatedShippingCost: 8, // Average shipping cost for buyers
    maxPurchasePrice: 100, // Maximum purchase price per item
  },

  // ==================== FACEBOOK LOGIN ====================
  facebook: {
    email: process.env.FB_EMAIL || '',
    password: process.env.FB_PASSWORD || '',
    enabled: false, // Disabled by default
    nationwideSearch: true,
    searchRadius: 'nationwide'
  },

  // ==================== SEARCH SETTINGS ====================
  search: {
    maxPricePerItem: 25,
    maxResultsPerPlatform: 20,
    searchDelay: 3000, // milliseconds between searches
    facebookDelay: 5000,
    humanDelay: {
      min: 500,
      max: 2000
    },
    enablePriceHistory: true,
    trackCompletedSales: true
  },

  // ==================== BROWSER SETTINGS ====================
  browser: {
    headless: true, // Run headless for autonomous operation
    slowMo: 1000,
    timeout: 30000,
    keepOpen: false // Close browser when done
  },

  // ==================== RESULTS SETTINGS ====================
  results: {
    downloadImages: true,
    saveCSV: true,
    saveJSON: true,
    includeTimestamp: true,
    trackHistory: true,
    maxHistoryDays: 90 // Keep 90 days of history
  },

  // ==================== LOGGING SETTINGS ====================
  logging: {
    level: 'info', // 'error', 'warn', 'info', 'debug'
    console: true,
    file: true,
    filePath: './logs',
    maxFiles: 10,
    maxSize: '10m'
  },

  // ==================== BUNDLE STRATEGY ====================
  strategy: {
    targetItems: [
      'GE Sonic plush',
      'GE Shadow plush',
      'GE Tails plush',
      'GE Knuckles plush',
      'Boom8 Sonic figure',
      'Boom8 Shadow figure',
      'Sonic Adventure figure',
      'First4Figures Sonic',
      'Jazwares Sonic'
    ],

    bundles: [
      {
        name: "Hero Team Plush Pack",
        items: ["GE Sonic Plush", "GE Tails Plush", "GE Knuckles Plush"],
        targetCost: 60,
        resaleValue: 120,
        minMargin: 50
      },
      {
        name: "Shadow & Rivals Collector Set",
        items: ["GE Shadow Plush", "GE Sonic Plush", "Boom8 Shadow Figure"],
        targetCost: 70,
        resaleValue: 145,
        minMargin: 50
      },
      {
        name: "Complete Team Set",
        items: ["GE Sonic Plush", "GE Tails Plush", "GE Knuckles Plush", "GE Shadow Plush"],
        targetCost: 80,
        resaleValue: 180,
        minMargin: 60
      }
    ],

    alternativeSearchTerms: [
      'Great Eastern Sonic',
      'GE Animation Shadow',
      'First4Figures Boom8',
      'Sonic Adventure 2 plush',
      'SEGA official plush',
      'Sonic Team plush',
      'Jazwares Sonic figure',
      'Tomy Sonic plush'
    ]
  },

  // ==================== PLATFORM SETTINGS ====================
  platforms: {
    ebay: {
      enabled: true,
      baseUrl: 'https://www.ebay.com',
      searchPath: '/sch/i.html'
    },
    mercari: {
      enabled: true,
      baseUrl: 'https://www.mercari.com'
    },
    facebook: {
      enabled: false,
      baseUrl: 'https://www.facebook.com/marketplace',
      requireLogin: true,
      nationwideSearch: true
    },
    offerup: {
      enabled: true,
      baseUrl: 'https://offerup.com',
      requireLogin: false
    },
    poshmark: {
      enabled: true,
      baseUrl: 'https://poshmark.com',
      requireLogin: false
    },
    depop: {
      enabled: true,
      baseUrl: 'https://depop.com',
      requireLogin: false
    },
    etsy: {
      enabled: true,
      baseUrl: 'https://etsy.com',
      requireLogin: false
    },
    shopgoodwill: {
      enabled: true,
      baseUrl: 'https://shopgoodwill.com',
      requireLogin: false
    }
  }
};
