const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('./config');
const { logger } = require('./utils/logger');
const { database } = require('./utils/database');
const { telegram } = require('./utils/telegram');
const { profitCalculator } = require('./utils/profit-calculator');

class SonicBundleHunter {
  constructor() {
    this.results = [];
    this.browser = null;
    this.page = null;
    this.facebookLoggedIn = false;
    this.config = config;
    this.stats = {
      searches: 0,
      itemsFound: 0,
      profitableDeals: 0,
      totalPotentialProfit: 0
    };
  }

  async init() {
    logger.info('Initializing Sonic Bundle Hunter...');

    // Ensure directories exist
    const dirs = [
      'sonic_results',
      'sonic_results/images',
      'data',
      'logs'
    ];

    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });

    // Initialize database
    await database.init();

    // Initialize Telegram if enabled
    if (this.config.telegram.enabled) {
      await telegram.init();
    }

    this.browser = await chromium.launch({
      headless: this.config.browser.headless,
      slowMo: this.config.browser.slowMo
    });
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(this.config.browser.timeout);

    logger.info('📁 Results will be saved to: ./sonic_results/');
  }

  async humanDelay() {
    const delay = Math.random() *
      (this.config.search.humanDelay.max - this.config.search.humanDelay.min) +
      this.config.search.humanDelay.min;
    await this.page.waitForTimeout(delay);
  }

  async searchEbay(searchTerm) {
    logger.info(`🔍 Searching eBay for: ${searchTerm}`);
    this.stats.searches++;

    try {
      await this.page.goto('https://www.ebay.com');
      await this.humanDelay();

      const searchSelectors = [
        '[data-testid="s0-1-0-5-4-0-search-box"]',
        '#gh-ac',
        'input[name="_nkw"]',
        'input[placeholder*="Search"]',
        'input[type="search"]'
      ];

      let searchInput = null;
      for (const selector of searchSelectors) {
        try {
          searchInput = await this.page.waitForSelector(selector, { timeout: 5000 });
          if (searchInput) {
            logger.debug(`Found eBay search box with selector: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!searchInput) {
        logger.error('Could not find eBay search box');
        return [];
      }

      await searchInput.click();
      await this.humanDelay();
      await searchInput.fill('');
      await this.humanDelay();
      await searchInput.type(searchTerm, { delay: 100 });
      await this.humanDelay();
      await searchInput.press('Enter');
      await this.page.waitForLoadState('networkidle');

      // Filter by price
      const priceFilterUrl = this.page.url() + `&_udhi=${this.config.search.maxPricePerItem}`;
      await this.page.goto(priceFilterUrl);
      await this.page.waitForLoadState('networkidle');

      const items = await this.page.evaluate((maxPrice) => {
        const results = [];
        const listings = document.querySelectorAll('.s-item');

        listings.forEach((listing, index) => {
          if (index === 0) return;

          try {
            const titleElement = listing.querySelector('.s-item__title');
            const priceElement = listing.querySelector('.s-item__price');
            const linkElement = listing.querySelector('.s-item__link');
            const imageElement = listing.querySelector('.s-item__image img');
            const shippingElement = listing.querySelector('.s-item__shipping');
            const conditionElement = listing.querySelector('.SECONDARY_INFO');

            if (titleElement && priceElement && linkElement) {
              const title = titleElement.textContent.trim();
              const priceText = priceElement.textContent.trim();
              const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));

              if (price <= maxPrice && price > 0) {
                results.push({
                  title,
                  price: priceText,
                  priceNumeric: price,
                  url: linkElement.href,
                  image: imageElement ? imageElement.src : null,
                  shipping: shippingElement ? shippingElement.textContent.trim() : 'N/A',
                  condition: conditionElement ? conditionElement.textContent.trim() : 'N/A',
                  platform: 'eBay',
                  searchTerm,
                  timestamp: new Date().toISOString()
                });
              }
            }
          } catch (e) {
            // Skip this listing
          }
        });

        return results.slice(0, 20);
      }, this.config.search.maxPricePerItem);

      logger.info(`✅ Found ${items.length} items on eBay for "${searchTerm}"`);
      return items;

    } catch (error) {
      logger.error(`❌ Error searching eBay for ${searchTerm}: ${error.message}`);
      return [];
    }
  }

  async searchMercari(searchTerm) {
    logger.info(`🔍 Searching Mercari for: ${searchTerm}`);
    this.stats.searches++;

    try {
      await this.page.goto('https://www.mercari.com');
      await this.humanDelay();

      const searchSelectors = [
        'input[data-testid="SearchInput"]',
        'input[placeholder*="Search"]',
        'input[type="search"]',
        'input[name="search"]'
      ];

      let searchInput = null;
      for (const selector of searchSelectors) {
        try {
          searchInput = await this.page.waitForSelector(selector, { timeout: 5000 });
          if (searchInput) {
            logger.debug(`Found Mercari search box with selector: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!searchInput) {
        logger.error('Could not find Mercari search box');
        return [];
      }

      await searchInput.click();
      await this.humanDelay();
      await searchInput.fill('');
      await this.humanDelay();
      await searchInput.type(searchTerm, { delay: 100 });
      await this.humanDelay();
      await searchInput.press('Enter');
      await this.page.waitForLoadState('networkidle');

      const currentUrl = this.page.url();
      const filteredUrl = currentUrl + `&price_max=${this.config.search.maxPricePerItem}`;
      await this.page.goto(filteredUrl);
      await this.page.waitForLoadState('networkidle');

      const items = await this.page.evaluate((maxPrice) => {
        const results = [];
        const listings = document.querySelectorAll('[data-testid*="ItemCell"]');

        listings.forEach(listing => {
          try {
            const titleElement = listing.querySelector('[data-testid*="ItemName"]');
            const priceElement = listing.querySelector('[data-testid*="ItemPrice"]');
            const linkElement = listing.querySelector('a');
            const imageElement = listing.querySelector('img');

            if (titleElement && priceElement && linkElement) {
              const title = titleElement.textContent.trim();
              const priceText = priceElement.textContent.trim();
              const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));

              if (price <= maxPrice && price > 0) {
                results.push({
                  title,
                  price: priceText,
                  priceNumeric: price,
                  url: 'https://www.mercari.com' + linkElement.getAttribute('href'),
                  image: imageElement ? imageElement.src : null,
                  platform: 'Mercari',
                  searchTerm,
                  timestamp: new Date().toISOString()
                });
              }
            }
          } catch (e) {
            // Skip this listing
          }
        });

        return results.slice(0, 15);
      }, this.config.search.maxPricePerItem);

      logger.info(`✅ Found ${items.length} items on Mercari for "${searchTerm}"`);
      return items;

    } catch (error) {
      logger.error(`❌ Error searching Mercari for ${searchTerm}: ${error.message}`);
      return [];
    }
  }

  async loginToFacebook(email, password) {
    logger.info('🔐 Logging into Facebook...');

    try {
      await this.page.goto('https://www.facebook.com/login');
      await this.page.waitForTimeout(2000);

      await this.page.fill('#email', email);
      await this.page.fill('#pass', password);
      await this.page.click('[name="login"]');

      await this.page.waitForTimeout(5000);

      const currentUrl = this.page.url();
      if (currentUrl.includes('checkpoint') || currentUrl.includes('two_factor')) {
        logger.warn('2FA or security check detected. Please complete manually.');
        await new Promise(resolve => {
          process.stdin.once('data', () => resolve());
        });
      }

      await this.page.goto('https://www.facebook.com/marketplace');
      await this.page.waitForTimeout(3000);

      logger.info('✅ Successfully logged into Facebook');
      return true;

    } catch (error) {
      logger.error(`❌ Facebook login failed: ${error.message}`);
      return false;
    }
  }

  async searchFacebookMarketplace(searchTerm) {
    logger.info(`🔍 Searching Facebook Marketplace (Nationwide) for: ${searchTerm}`);
    this.stats.searches++;

    try {
      await this.page.goto('https://www.facebook.com/marketplace');
      await this.page.waitForTimeout(3000);

      const searchSelectors = [
        'input[placeholder*="Search Marketplace"]',
        'input[aria-label*="Search Marketplace"]',
        '[data-testid="marketplace-search-input"]',
        'input[type="search"]'
      ];

      let searchInput = null;
      for (const selector of searchSelectors) {
        try {
          searchInput = await this.page.waitForSelector(selector, { timeout: 3000 });
          if (searchInput) break;
        } catch (e) {
          continue;
        }
      }

      if (!searchInput) {
        logger.error('Could not find Facebook search input');
        return [];
      }

      await searchInput.fill(searchTerm);
      await searchInput.press('Enter');
      await this.page.waitForTimeout(5000);

      // Try to set nationwide search
      try {
        await this.page.click('text=Location', { timeout: 3000 });
        await this.page.waitForTimeout(2000);

        const nationwideOptions = [
          'text=Nationwide',
          'text=Anywhere',
          'text=All locations',
          'text=United States'
        ];

        for (const option of nationwideOptions) {
          try {
            await this.page.click(option, { timeout: 2000 });
            logger.debug('Set Facebook search to nationwide');
            break;
          } catch (e) {
            continue;
          }
        }

        await this.page.waitForTimeout(3000);
      } catch (e) {
        logger.warn('Could not set nationwide search, continuing with current location');
      }

      // Try to set price filter
      try {
        await this.page.click('text=Filters', { timeout: 3000 });
        await this.page.waitForTimeout(2000);

        const priceInputs = await this.page.$$('input[type="number"]');
        if (priceInputs.length >= 2) {
          await priceInputs[1].fill(this.config.search.maxPricePerItem.toString());
          await this.page.click('text=Apply', { timeout: 2000 });
          await this.page.waitForTimeout(3000);
        }
      } catch (e) {
        logger.warn('Could not set price filter');
      }

      const items = await this.page.evaluate((searchTerm, maxPrice) => {
        const results = [];

        const possibleSelectors = [
          '[data-testid*="marketplace"]',
          '[role="article"]',
          'div[style*="cursor: pointer"]',
          'a[href*="/marketplace/item/"]'
        ];

        let listings = [];
        for (const selector of possibleSelectors) {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            listings = Array.from(elements);
            break;
          }
        }

        listings.forEach((listing, index) => {
          if (index > 50) return;

          try {
            const titleSelectors = [
              'span[dir="auto"]',
              'div[style*="font-weight"]',
              'strong',
              'h3',
              'h4'
            ];

            let titleElement = null;
            let title = '';

            for (const selector of titleSelectors) {
              const elements = listing.querySelectorAll(selector);
              for (const el of elements) {
                const text = el.textContent.trim();
                if (text.length > 10 && text.length < 200 &&
                    (text.toLowerCase().includes('sonic') ||
                     text.toLowerCase().includes('shadow') ||
                     text.toLowerCase().includes('tails') ||
                     text.toLowerCase().includes('knuckles'))) {
                  title = text;
                  titleElement = el;
                  break;
                }
              }
              if (title) break;
            }

            let price = '';
            let priceNumeric = 0;
            const allText = listing.textContent;
            const priceMatch = allText.match(/\$[\d,]+(?:\.\d{2})?/);
            if (priceMatch) {
              price = priceMatch[0];
              priceNumeric = parseFloat(price.replace(/[^0-9.]/g, ''));
            }

            const imageElement = listing.querySelector('img');
            const image = imageElement ? imageElement.src : null;

            const linkElement = listing.querySelector('a[href*="/marketplace/item/"]') ||
                              listing.closest('a') ||
                              listing.querySelector('a');

            let url = '';
            if (linkElement && linkElement.href) {
              url = linkElement.href.startsWith('http') ? linkElement.href :
                    'https://www.facebook.com' + linkElement.href;
            }

            if (title && price && (priceNumeric <= maxPrice && priceNumeric > 0)) {
              results.push({
                title: title,
                price: price,
                priceNumeric: priceNumeric,
                url: url,
                image: image,
                platform: 'Facebook Marketplace (Nationwide)',
                searchTerm: searchTerm,
                timestamp: new Date().toISOString()
              });
            }
          } catch (e) {
            // Skip this listing
          }
        });

        return results.slice(0, 30);
      }, searchTerm, this.config.search.maxPricePerItem);

      logger.info(`✅ Found ${items.length} items on Facebook Marketplace for "${searchTerm}"`);
      return items;

    } catch (error) {
      logger.error(`❌ Error searching Facebook Marketplace for ${searchTerm}: ${error.message}`);
      return [];
    }
  }

  async searchOfferUp(searchTerm) {
    logger.info(`🔍 Searching OfferUp for: ${searchTerm}`);
    this.stats.searches++;

    try {
      await this.page.goto('https://offerup.com');
      await this.humanDelay();

      const searchSelectors = [
        'input[placeholder*="Search"]',
        'input[type="search"]',
        'input[name="q"]',
        '[data-testid="search-input"]'
      ];

      let searchInput = null;
      for (const selector of searchSelectors) {
        try {
          searchInput = await this.page.waitForSelector(selector, { timeout: 5000 });
          if (searchInput) {
            logger.debug(`Found OfferUp search box with selector: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!searchInput) {
        logger.error('Could not find OfferUp search box');
        return [];
      }

      await searchInput.fill(searchTerm);
      await searchInput.press('Enter');
      await this.page.waitForLoadState('networkidle');

      const items = await this.page.evaluate((searchTerm, maxPrice) => {
        const results = [];
        const listings = document.querySelectorAll('[data-testid*="item"]');

        listings.forEach(listing => {
          try {
            const titleElement = listing.querySelector('[data-testid*="title"]');
            const priceElement = listing.querySelector('[data-testid*="price"]');
            const linkElement = listing.querySelector('a');
            const imageElement = listing.querySelector('img');

            if (titleElement && priceElement && linkElement) {
              const title = titleElement.textContent.trim();
              const priceText = priceElement.textContent.trim();
              const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));

              if (price <= maxPrice && price > 0) {
                results.push({
                  title,
                  price: priceText,
                  priceNumeric: price,
                  url: linkElement.href,
                  image: imageElement ? imageElement.src : null,
                  platform: 'OfferUp',
                  searchTerm,
                  timestamp: new Date().toISOString()
                });
              }
            }
          } catch (e) {
            // Skip this listing
          }
        });

        return results.slice(0, 15);
      }, searchTerm, this.config.search.maxPricePerItem);

      logger.info(`✅ Found ${items.length} items on OfferUp for "${searchTerm}"`);
      return items;

    } catch (error) {
      logger.error(`❌ Error searching OfferUp for ${searchTerm}: ${error.message}`);
      return [];
    }
  }

  async searchPoshmark(searchTerm) {
    logger.info(`🔍 Searching Poshmark for: ${searchTerm}`);
    this.stats.searches++;

    try {
      await this.page.goto('https://poshmark.com');
      await this.humanDelay();

      const searchInput = await this.page.waitForSelector('input[placeholder*="Search"]', { timeout: 5000 });
      if (!searchInput) {
        logger.error('Could not find Poshmark search box');
        return [];
      }

      await searchInput.fill(searchTerm);
      await searchInput.press('Enter');
      await this.page.waitForLoadState('networkidle');

      const items = await this.page.evaluate((searchTerm, maxPrice) => {
        const results = [];
        const listings = document.querySelectorAll('[data-testid*="listing"]');

        listings.forEach(listing => {
          try {
            const titleElement = listing.querySelector('[data-testid*="title"]');
            const priceElement = listing.querySelector('[data-testid*="price"]');
            const linkElement = listing.querySelector('a');
            const imageElement = listing.querySelector('img');

            if (titleElement && priceElement && linkElement) {
              const title = titleElement.textContent.trim();
              const priceText = priceElement.textContent.trim();
              const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));

              if (price <= maxPrice && price > 0) {
                results.push({
                  title,
                  price: priceText,
                  priceNumeric: price,
                  url: linkElement.href,
                  image: imageElement ? imageElement.src : null,
                  platform: 'Poshmark',
                  searchTerm,
                  timestamp: new Date().toISOString()
                });
              }
            }
          } catch (e) {
            // Skip this listing
          }
        });

        return results.slice(0, 15);
      }, searchTerm, this.config.search.maxPricePerItem);

      logger.info(`✅ Found ${items.length} items on Poshmark for "${searchTerm}"`);
      return items;

    } catch (error) {
      logger.error(`❌ Error searching Poshmark for ${searchTerm}: ${error.message}`);
      return [];
    }
  }

  async searchDepop(searchTerm) {
    logger.info(`🔍 Searching Depop for: ${searchTerm}`);
    this.stats.searches++;

    try {
      await this.page.goto('https://depop.com');
      await this.humanDelay();

      const searchInput = await this.page.waitForSelector('input[placeholder*="Search"]', { timeout: 5000 });
      if (!searchInput) {
        logger.error('Could not find Depop search box');
        return [];
      }

      await searchInput.fill(searchTerm);
      await searchInput.press('Enter');
      await this.page.waitForLoadState('networkidle');

      const items = await this.page.evaluate((searchTerm, maxPrice) => {
        const results = [];
        const listings = document.querySelectorAll('[data-testid*="product"]');

        listings.forEach(listing => {
          try {
            const titleElement = listing.querySelector('[data-testid*="title"]');
            const priceElement = listing.querySelector('[data-testid*="price"]');
            const linkElement = listing.querySelector('a');
            const imageElement = listing.querySelector('img');

            if (titleElement && priceElement && linkElement) {
              const title = titleElement.textContent.trim();
              const priceText = priceElement.textContent.trim();
              const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));

              if (price <= maxPrice && price > 0) {
                results.push({
                  title,
                  price: priceText,
                  priceNumeric: price,
                  url: linkElement.href,
                  image: imageElement ? imageElement.src : null,
                  platform: 'Depop',
                  searchTerm,
                  timestamp: new Date().toISOString()
                });
              }
            }
          } catch (e) {
            // Skip this listing
          }
        });

        return results.slice(0, 15);
      }, searchTerm, this.config.search.maxPricePerItem);

      logger.info(`✅ Found ${items.length} items on Depop for "${searchTerm}"`);
      return items;

    } catch (error) {
      logger.error(`❌ Error searching Depop for ${searchTerm}: ${error.message}`);
      return [];
    }
  }

  async searchEtsy(searchTerm) {
    logger.info(`🔍 Searching Etsy for: ${searchTerm}`);
    this.stats.searches++;

    try {
      await this.page.goto('https://etsy.com');
      await this.humanDelay();

      const searchInput = await this.page.waitForSelector('input[name="search_query"]', { timeout: 5000 });
      if (!searchInput) {
        logger.error('Could not find Etsy search box');
        return [];
      }

      await searchInput.fill(searchTerm);
      await searchInput.press('Enter');
      await this.page.waitForLoadState('networkidle');

      const items = await this.page.evaluate((searchTerm, maxPrice) => {
        const results = [];
        const listings = document.querySelectorAll('[data-listing-id]');

        listings.forEach(listing => {
          try {
            const titleElement = listing.querySelector('h3');
            const priceElement = listing.querySelector('.currency-value');
            const linkElement = listing.querySelector('a');
            const imageElement = listing.querySelector('img');

            if (titleElement && priceElement && linkElement) {
              const title = titleElement.textContent.trim();
              const priceText = priceElement.textContent.trim();
              const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));

              if (price <= maxPrice && price > 0) {
                results.push({
                  title,
                  price: priceText,
                  priceNumeric: price,
                  url: linkElement.href,
                  image: imageElement ? imageElement.src : null,
                  platform: 'Etsy',
                  searchTerm,
                  timestamp: new Date().toISOString()
                });
              }
            }
          } catch (e) {
            // Skip this listing
          }
        });

        return results.slice(0, 15);
      }, searchTerm, this.config.search.maxPricePerItem);

      logger.info(`✅ Found ${items.length} items on Etsy for "${searchTerm}"`);
      return items;

    } catch (error) {
      logger.error(`❌ Error searching Etsy for ${searchTerm}: ${error.message}`);
      return [];
    }
  }

  async searchShopGoodwill(searchTerm) {
    logger.info(`🔍 Searching ShopGoodwill for: ${searchTerm}`);
    this.stats.searches++;

    try {
      await this.page.goto('https://shopgoodwill.com');
      await this.humanDelay();

      const searchInput = await this.page.waitForSelector('input[name="q"]', { timeout: 5000 });
      if (!searchInput) {
        logger.error('Could not find ShopGoodwill search box');
        return [];
      }

      await searchInput.fill(searchTerm);
      await searchInput.press('Enter');
      await this.page.waitForLoadState('networkidle');

      const items = await this.page.evaluate((searchTerm, maxPrice) => {
        const results = [];
        const listings = document.querySelectorAll('.item');

        listings.forEach(listing => {
          try {
            const titleElement = listing.querySelector('.item-title');
            const priceElement = listing.querySelector('.current-price');
            const linkElement = listing.querySelector('a');
            const imageElement = listing.querySelector('img');

            if (titleElement && priceElement && linkElement) {
              const title = titleElement.textContent.trim();
              const priceText = priceElement.textContent.trim();
              const price = parseFloat(priceText.replace(/[^0-9.]/g, ''));

              if (price <= maxPrice && price > 0) {
                results.push({
                  title,
                  price: priceText,
                  priceNumeric: price,
                  url: linkElement.href,
                  image: imageElement ? imageElement.src : null,
                  platform: 'ShopGoodwill',
                  searchTerm,
                  timestamp: new Date().toISOString()
                });
              }
            }
          } catch (e) {
            // Skip this listing
          }
        });

        return results.slice(0, 15);
      }, searchTerm, this.config.search.maxPricePerItem);

      logger.info(`✅ Found ${items.length} items on ShopGoodwill for "${searchTerm}"`);
      return items;

    } catch (error) {
      logger.error(`❌ Error searching ShopGoodwill for ${searchTerm}: ${error.message}`);
      return [];
    }
  }

  async analyzeProfit(item) {
    // Calculate profit with fees
    const analysis = profitCalculator.calculate(item);

    // Store profitable deals in database
    if (analysis.profitable) {
      this.stats.profitableDeals++;
      this.stats.totalPotentialProfit += analysis.netProfit;

      await database.saveItem({
        ...item,
        ...analysis,
        foundAt: new Date().toISOString()
      });

      logger.info(`💰 PROFITABLE DEAL: ${item.title} - ${item.price} → ${analysis.suggestedPrice} (${analysis.margin}% margin)`);

      // Send Telegram notification if enabled
      if (this.config.telegram.enabled) {
        if (this.config.telegram.notifyOnDeal || (this.config.telegram.notifyOnHighProfit && analysis.margin >= 50)) {
          await telegram.sendDealAlert(item, analysis);
        }
      }
    }

    return analysis;
  }

  async analyzeBundles() {
    logger.info('📊 ANALYZING BUNDLE OPPORTUNITIES...');

    const bundleOpportunities = [];

    for (const bundle of this.config.strategy.bundles) {
      logger.info(`🎯 Analyzing: ${bundle.name}`);
      logger.info(`Target items: ${bundle.items.join(', ')}`);

      const availableItems = [];

      for (const requiredItem of bundle.items) {
        const matches = this.results.filter(item =>
          item.title.toLowerCase().includes(requiredItem.toLowerCase().split(' ')[0]) &&
          item.title.toLowerCase().includes(requiredItem.toLowerCase().split(' ')[1])
        );

        if (matches.length > 0) {
          const bestMatch = matches.sort((a, b) => a.priceNumeric - b.priceNumeric)[0];
          availableItems.push(bestMatch);
          logger.info(`  ✅ Found: ${bestMatch.title} - ${bestMatch.price} (${bestMatch.platform})`);
        } else {
          logger.info(`  ❌ Missing: ${requiredItem}`);
        }
      }

      if (availableItems.length === bundle.items.length) {
        const totalCost = availableItems.reduce((sum, item) => sum + item.priceNumeric, 0);
        const profit = bundle.resaleValue - totalCost;
        const margin = ((profit / totalCost) * 100).toFixed(1);

        // Calculate fees for bundle
        const fees = profitCalculator.calculateBundleFees(availableItems, bundle.resaleValue);

        const netProfit = profit - fees.total;
        const netMargin = ((netProfit / totalCost) * 100).toFixed(1);

        bundleOpportunities.push({
          bundleName: bundle.name,
          items: availableItems,
          totalCost,
          resaleValue: bundle.resaleValue,
          grossProfit: profit,
          fees,
          netProfit,
          margin: `${margin}%`,
          netMargin: `${netMargin}%`,
          viable: totalCost <= bundle.targetCost && netProfit >= (totalCost * 0.3)
        });

        logger.info(`  💰 Bundle total: $${totalCost.toFixed(2)}`);
        logger.info(`  📈 Net profit: $${netProfit.toFixed(2)} (${netMargin}% margin)`);
        logger.info(`  ${totalCost <= bundle.targetCost && netProfit >= (totalCost * 0.3) ? '✅ VIABLE' : '❌ TOO EXPENSIVE'}`);

        // Save bundle to database
        await database.saveBundle(bundleOpportunities[bundleOpportunities.length - 1]);

        // Send Telegram alert for viable bundles
        if (this.config.telegram.enabled && bundleOpportunities[bundleOpportunities.length - 1].viable) {
          await telegram.sendBundleAlert(bundleOpportunities[bundleOpportunities.length - 1]);
        }
      }
    }

    return bundleOpportunities;
  }

  async saveResults() {
    const timestamp = new Date().toISOString().split('T')[0];

    // Save detailed results
    const detailedResults = {
      searchDate: new Date().toISOString(),
      totalItems: this.results.length,
      stats: this.stats,
      strategy: this.config.strategy,
      items: this.results,
      bundles: await this.analyzeBundles()
    };

    fs.writeFileSync(
      `sonic_results/sonic_collectibles_${timestamp}.json`,
      JSON.stringify(detailedResults, null, 2)
    );

    // Save CSV for easy viewing
    const csvHeaders = 'Title,Price,Platform,URL,Condition,Shipping,Search Term,Timestamp\n';
    const csvRows = this.results.map(item =>
      `"${item.title}","${item.price}","${item.platform}","${item.url}","${item.condition || 'N/A'}","${item.shipping || 'N/A'}","${item.searchTerm}","${item.timestamp}"`
    ).join('\n');

    fs.writeFileSync(`sonic_results/sonic_collectibles_${timestamp}.csv`, csvHeaders + csvRows);

    logger.info(`💾 Results saved to sonic_results/sonic_collectibles_${timestamp}.json`);
    logger.info(`📊 CSV saved to sonic_results/sonic_collectibles_${timestamp}.csv`);
  }

  async run() {
    await this.init();

    logger.info('🚀 Starting Sonic Collectible Bundle Hunt...');

    // Prompt for Facebook credentials if not set and Facebook is enabled
    if (this.config.facebook.enabled && (!this.config.facebook.email || !this.config.facebook.password)) {
      logger.info('📧 Facebook login required for Marketplace search.');
      logger.info('You can either:');
      logger.info('1. Set FB_EMAIL and FB_PASSWORD environment variables');
      logger.info('2. Edit the facebook credentials in config.js');
      logger.info('3. Skip Facebook search (press Enter)\n');

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      if (!this.config.facebook.email) {
        this.config.facebook.email = await new Promise(resolve => {
          rl.question('Facebook Email (or press Enter to skip): ', resolve);
        });
      }

      if (this.config.facebook.email && !this.config.facebook.password) {
        this.config.facebook.password = await new Promise(resolve => {
          rl.question('Facebook Password: ', resolve);
        });
      }

      rl.close();
    }

    // Login to Facebook if credentials provided and enabled
    if (this.config.facebook.enabled && this.config.facebook.email && this.config.facebook.password) {
      this.facebookLoggedIn = await this.loginToFacebook(
        this.config.facebook.email,
        this.config.facebook.password
      );
    }

    // Search all target items
    for (const searchTerm of this.config.strategy.targetItems) {
      logger.info(`\n🎯 Searching for: ${searchTerm}`);

      // Search eBay
      if (this.config.platforms.ebay.enabled) {
        const ebayResults = await this.searchEbay(searchTerm);
        this.results.push(...ebayResults);
        await this.page.waitForTimeout(this.config.search.searchDelay);
      }

      // Search Mercari
      if (this.config.platforms.mercari.enabled) {
        const mercariResults = await this.searchMercari(searchTerm);
        this.results.push(...mercariResults);
        await this.page.waitForTimeout(this.config.search.searchDelay);
      }

      // Search Facebook Marketplace if logged in
      if (this.config.platforms.facebook.enabled && this.facebookLoggedIn) {
        const facebookResults = await this.searchFacebookMarketplace(searchTerm);
        this.results.push(...facebookResults);
        await this.page.waitForTimeout(this.config.search.facebookDelay);
      } else if (this.config.platforms.facebook.enabled) {
        logger.info('⏭️  Skipping Facebook Marketplace (not logged in)');
      }

      // Search OfferUp
      if (this.config.platforms.offerup.enabled) {
        const offerupResults = await this.searchOfferUp(searchTerm);
        this.results.push(...offerupResults);
        await this.page.waitForTimeout(this.config.search.searchDelay);
      }

      // Search Poshmark
      if (this.config.platforms.poshmark.enabled) {
        const poshmarkResults = await this.searchPoshmark(searchTerm);
        this.results.push(...poshmarkResults);
        await this.page.waitForTimeout(this.config.search.searchDelay);
      }

      // Search Depop
      if (this.config.platforms.depop.enabled) {
        const depopResults = await this.searchDepop(searchTerm);
        this.results.push(...depopResults);
        await this.page.waitForTimeout(this.config.search.searchDelay);
      }

      // Search Etsy
      if (this.config.platforms.etsy.enabled) {
        const etsyResults = await this.searchEtsy(searchTerm);
        this.results.push(...etsyResults);
        await this.page.waitForTimeout(this.config.search.searchDelay);
      }

      // Search ShopGoodwill
      if (this.config.platforms.shopgoodwill.enabled) {
        const shopgoodwillResults = await this.searchShopGoodwill(searchTerm);
        this.results.push(...shopgoodwillResults);
        await this.page.waitForTimeout(this.config.search.searchDelay);
      }
    }

    // Analyze all items for profit
    logger.info('\n💰 Analyzing items for profit opportunities...');
    for (const item of this.results) {
      await this.analyzeProfit(item);
    }

    // Analyze and save results
    await this.saveResults();

    logger.info(`\n🎉 Hunt complete! Found ${this.results.length} total items.`);
    logger.info(`📊 Stats: ${this.stats.searches} searches, ${this.stats.profitableDeals} profitable deals, $${this.stats.totalPotentialProfit.toFixed(2)} potential profit`);

    const platformCounts = this.results.reduce((acc, item) => {
      acc[item.platform] = (acc[item.platform] || 0) + 1;
      return acc;
    }, {});

    Object.entries(platformCounts).forEach(([platform, count]) => {
      logger.info(`  ${platform}: ${count} items`);
    });

    logger.info('\n🌐 Platforms searched:');
    logger.info(`  ✅ eBay: ${this.config.platforms.ebay.enabled ? 'Enabled' : 'Disabled'}`);
    logger.info(`  ✅ Mercari: ${this.config.platforms.mercari.enabled ? 'Enabled' : 'Disabled'}`);
    logger.info(`  ✅ Facebook Marketplace (Nationwide): ${this.config.platforms.facebook.enabled ? 'Enabled' : 'Disabled'}`);
    logger.info(`  ✅ OfferUp: ${this.config.platforms.offerup.enabled ? 'Enabled' : 'Disabled'}`);
    logger.info(`  ✅ Poshmark: ${this.config.platforms.poshmark.enabled ? 'Enabled' : 'Disabled'}`);
    logger.info(`  ✅ Depop: ${this.config.platforms.depop.enabled ? 'Enabled' : 'Disabled'}`);
    logger.info(`  ✅ Etsy: ${this.config.platforms.etsy.enabled ? 'Enabled' : 'Disabled'}`);
    logger.info(`  ✅ ShopGoodwill: ${this.config.platforms.shopgoodwill.enabled ? 'Enabled' : 'Disabled'}`);

    logger.info('\n📁 Check the sonic_results folder for detailed data.');

    // Send summary notification
    if (this.config.telegram.enabled && this.config.telegram.notifyOnSummary) {
      await telegram.sendDailySummary(this.stats, platformCounts);
    }

    // Close browser
    if (!this.config.browser.keepOpen) {
      await this.browser.close();
    }
  }
}

module.exports = SonicBundleHunter;
