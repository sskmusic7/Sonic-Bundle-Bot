// config.js - Configuration file for Sonic Bundle Hunter

module.exports = {
  // Facebook Login (set these or use environment variables)
  facebook: {
    email: process.env.FB_EMAIL || '', // Set your Facebook email here or use FB_EMAIL env var
    password: process.env.FB_PASSWORD || '', // Set your Facebook password here or use FB_PASSWORD env var
    enabled: true, // Set to false to skip Facebook entirely
    nationwideSearch: true, // Search nationwide instead of local area
    searchRadius: 'nationwide' // Options: 'nationwide', '100mi', '50mi', '25mi'
  },

  // Search settings
  search: {
    maxPricePerItem: 25,
    maxResultsPerPlatform: 20,
    searchDelay: 3000, // milliseconds between searches
    facebookDelay: 5000, // Facebook needs more time
    humanDelay: {
      min: 500,    // Minimum delay between actions
      max: 2000    // Maximum delay between actions
    }
  },

  // Browser settings
  browser: {
    headless: false, // Set to true to run without showing browser
    slowMo: 1000, // Delay between actions (milliseconds)
    timeout: 30000, // Page load timeout
    keepOpen: true // Keep browser open when script finishes
  },

  // Results settings
  results: {
    downloadImages: true,
    saveCSV: true,
    saveJSON: true,
    includeTimestamp: true
  },

  // Bundle strategy (matches your JSON)
  strategy: {
    targetItems: [
      'GE Sonic plush',
      'GE Shadow plush', 
      'GE Tails plush',
      'GE Knuckles plush',
      'Boom8 Sonic figure',
      'Boom8 Shadow figure'
    ],
    
    bundles: [
      {
        name: "Hero Team Plush Pack",
        items: ["GE Sonic Plush", "GE Tails Plush", "GE Knuckles Plush"],
        targetCost: 60,
        resaleValue: 120,
        minMargin: 50 // Minimum profit margin percentage
      },
      {
        name: "Shadow & Rivals Collector Set", 
        items: ["GE Shadow Plush", "GE Sonic Plush", "Boom8 Shadow Figure"],
        targetCost: 70,
        resaleValue: 145,
        minMargin: 50
      }
    ],

    // Additional search terms for broader hunting
    alternativeSearchTerms: [
      'Great Eastern Sonic',
      'GE Animation Shadow',
      'First4Figures Boom8',
      'Sonic Adventure 2 plush',
      'SEGA official plush',
      'Sonic Team plush'
    ]
  },

  // Platform-specific settings
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
      enabled: false, // Disabled for now - set to true and add credentials to enable
      baseUrl: 'https://www.facebook.com/marketplace',
      requireLogin: true,
      nationwideSearch: true
    },
    // New niche sites for collectibles
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
    },
    shopify: {
      enabled: true,
      baseUrl: 'https://shopify.com',
      requireLogin: false
    }
  }
}; 