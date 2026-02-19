const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('./config'); // Import configuration

class SonicBundleHunter {
  constructor() {
    this.results = [];
    this.browser = null;
    this.page = null;
    this.facebookLoggedIn = false;
    this.config = config;
  }

  async init() {
    this.browser = await chromium.launch({ 
      headless: this.config.browser.headless,
      slowMo: this.config.browser.slowMo
    });
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(this.config.browser.timeout);
    
    // Create results directory
    if (!fs.existsSync('sonic_results')) {
      fs.mkdirSync('sonic_results');
    }
    if (!fs.existsSync('sonic_results/images')) {
      fs.mkdirSync('sonic_results/images', { recursive: true });
    }
    
    console.log('📁 Results will be saved to: ./sonic_results/');
  }

  // Human-like random delay
  async humanDelay() {
    const delay = Math.random() * 
      (this.config.search.humanDelay.max - this.config.search.humanDelay.min) + 
      this.config.search.humanDelay.min;
    await this.page.waitForTimeout(delay);
  }

  async searchEbay(searchTerm) {
    console.log(`🔍 Searching eBay for: ${searchTerm}`);
    
    try {
      // Navigate to eBay
      await this.page.goto('https://www.ebay.com');
      await this.humanDelay();

      // Try multiple selectors for the search box
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
            console.log(`✅ Found eBay search box with selector: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!searchInput) {
        console.log('❌ Could not find eBay search box');
        return [];
      }

      // Clear and fill search box with human-like behavior
      await searchInput.click();
      await this.humanDelay();
      await searchInput.fill('');
      await this.humanDelay();
      await searchInput.type(searchTerm, { delay: 100 }); // Type like a human
      await this.humanDelay();
      await searchInput.press('Enter');
      await this.page.waitForLoadState('networkidle');

      // Filter by price (under configured max)
      const priceFilterUrl = this.page.url() + `&_udhi=${this.config.search.maxPricePerItem}`;
      await this.page.goto(priceFilterUrl);
      await this.page.waitForLoadState('networkidle');

      // Extract results
      const items = await this.page.evaluate((maxPrice) => {
        const results = [];
        const listings = document.querySelectorAll('.s-item');
        
        listings.forEach((listing, index) => {
          if (index === 0) return; // Skip first item (often ad)
          
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
            console.log('Error parsing listing:', e.message);
          }
        });
        
        return results.slice(0, 20); // Get top 20 results
      }, this.config.search.maxPricePerItem);

      console.log(`✅ Found ${items.length} items for "${searchTerm}"`);
      return items;

    } catch (error) {
      console.error(`❌ Error searching eBay for ${searchTerm}:`, error.message);
      return [];
    }
  }

  async searchMercari(searchTerm) {
    console.log(`🔍 Searching Mercari for: ${searchTerm}`);
    
    try {
      await this.page.goto('https://www.mercari.com');
      await this.humanDelay();

      // Try multiple selectors for Mercari search
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
            console.log(`✅ Found Mercari search box with selector: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!searchInput) {
        console.log('❌ Could not find Mercari search box');
        return [];
      }

      // Human-like search behavior
      await searchInput.click();
      await this.humanDelay();
      await searchInput.fill('');
      await this.humanDelay();
      await searchInput.type(searchTerm, { delay: 100 });
      await this.humanDelay();
      await searchInput.press('Enter');
      await this.page.waitForLoadState('networkidle');

      // Add price filter in URL
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
            console.log('Error parsing Mercari listing:', e.message);
          }
        });
        
        return results.slice(0, 15);
      }, this.config.search.maxPricePerItem);

      console.log(`✅ Found ${items.length} items on Mercari for "${searchTerm}"`);
      return items;

    } catch (error) {
      console.error(`❌ Error searching Mercari for ${searchTerm}:`, error.message);
      return [];
    }
  }

  async loginToFacebook(email, password) {
    console.log('🔐 Logging into Facebook...');
    
    try {
      await this.page.goto('https://www.facebook.com/login');
      await this.page.waitForTimeout(2000);

      // Fill login form
      await this.page.fill('#email', email);
      await this.page.fill('#pass', password);
      await this.page.click('[name="login"]');
      
      // Wait for login to complete - look for either dashboard or 2FA
      await this.page.waitForTimeout(5000);
      
      // Check if we need to handle 2FA or security check
      const currentUrl = this.page.url();
      if (currentUrl.includes('checkpoint') || currentUrl.includes('two_factor')) {
        console.log('⚠️  2FA or security check detected. Please complete manually in the browser.');
        console.log('Press Enter when ready to continue...');
        
        // Wait for user to handle 2FA manually
        await new Promise(resolve => {
          process.stdin.once('data', () => resolve());
        });
      }
      
      // Navigate to Marketplace
      await this.page.goto('https://www.facebook.com/marketplace');
      await this.page.waitForTimeout(3000);
      
      console.log('✅ Successfully logged into Facebook');
      return true;
      
    } catch (error) {
      console.error('❌ Facebook login failed:', error.message);
      return false;
    }
  }

  async searchFacebookMarketplace(searchTerm) {
    console.log(`🔍 Searching Facebook Marketplace NATIONWIDE for: ${searchTerm}`);
    
    try {
      // Navigate to marketplace search
      await this.page.goto('https://www.facebook.com/marketplace');
      await this.page.waitForTimeout(3000);

      // Find and click search box
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
        console.log('❌ Could not find Facebook search input');
        return [];
      }

      // Perform search
      await searchInput.fill(searchTerm);
      await searchInput.press('Enter');
      await this.page.waitForTimeout(5000);

      // Set nationwide search radius
      try {
        // Look for location filter to set nationwide
        await this.page.click('text=Location', { timeout: 3000 });
        await this.page.waitForTimeout(2000);
        
        // Try to select "Nationwide" or "Anywhere" option
        const nationwideOptions = [
          'text=Nationwide',
          'text=Anywhere',
          'text=All locations',
          'text=United States'
        ];
        
        for (const option of nationwideOptions) {
          try {
            await this.page.click(option, { timeout: 2000 });
            console.log('✅ Set Facebook search to nationwide');
            break;
          } catch (e) {
            continue;
          }
        }
        
        await this.page.waitForTimeout(3000);
      } catch (e) {
        console.log('⚠️  Could not set nationwide search, continuing with current location');
      }

      // Try to set price filter
      try {
        // Look for price filter options
        await this.page.click('text=Filters', { timeout: 3000 });
        await this.page.waitForTimeout(2000);
        
        // Try to set max price to configured amount
        const priceInputs = await this.page.$$('input[type="number"]');
        if (priceInputs.length >= 2) {
          await priceInputs[1].fill(this.config.search.maxPricePerItem.toString());
          await this.page.click('text=Apply', { timeout: 2000 });
          await this.page.waitForTimeout(3000);
        }
      } catch (e) {
        console.log('⚠️  Could not set price filter, continuing with all results');
      }

      // Extract marketplace listings
      const items = await this.page.evaluate((searchTerm, maxPrice) => {
        const results = [];
        
        // Multiple possible selectors for Facebook Marketplace items
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
          if (index > 50) return; // Increased limit for nationwide search
          
          try {
            // Try multiple ways to find title
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
            
            // Try to find price
            let price = '';
            let priceNumeric = 0;
            const allText = listing.textContent;
            const priceMatch = allText.match(/\$[\d,]+(?:\.\d{2})?/);
            if (priceMatch) {
              price = priceMatch[0];
              priceNumeric = parseFloat(price.replace(/[^0-9.]/g, ''));
            }
            
            // Try to find image
            const imageElement = listing.querySelector('img');
            const image = imageElement ? imageElement.src : null;
            
            // Try to find link
            const linkElement = listing.querySelector('a[href*="/marketplace/item/"]') || 
                              listing.closest('a') ||
                              listing.querySelector('a');
            
            let url = '';
            if (linkElement && linkElement.href) {
              url = linkElement.href.startsWith('http') ? linkElement.href : 
                    'https://www.facebook.com' + linkElement.href;
            }
            
            // Only add if we have meaningful data and price is under configured max
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
            // Skip this listing if there's an error
          }
        });
        
        return results.slice(0, 30); // Increased results for nationwide search
      }, searchTerm, this.config.search.maxPricePerItem);

      console.log(`✅ Found ${items.length} items on Facebook Marketplace (Nationwide) for "${searchTerm}"`);
      return items;

    } catch (error) {
      console.error(`❌ Error searching Facebook Marketplace for ${searchTerm}:`, error.message);
      return [];
    }
  }

  async searchOfferUp(searchTerm) {
    console.log(`🔍 Searching OfferUp for: ${searchTerm}`);
    
    try {
      await this.page.goto('https://offerup.com');
      await this.humanDelay();

      // Try to find search input
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
            console.log(`✅ Found OfferUp search box with selector: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }
      
      if (!searchInput) {
        console.log('❌ Could not find OfferUp search box');
        return [];
      }

      // Perform search
      await searchInput.fill(searchTerm);
      await searchInput.press('Enter');
      await this.page.waitForLoadState('networkidle');

      // Try to set price filter
      try {
        await this.page.click('text=Price', { timeout: 3000 });
        await this.page.waitForTimeout(2000);
        
        // Set max price
        const maxPriceInput = await this.page.$('input[placeholder*="Max"]');
        if (maxPriceInput) {
          await maxPriceInput.fill(this.config.search.maxPricePerItem.toString());
          await this.page.click('text=Apply', { timeout: 2000 });
          await this.page.waitForTimeout(3000);
        }
      } catch (e) {
        console.log('⚠️  Could not set OfferUp price filter');
      }

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

      console.log(`✅ Found ${items.length} items on OfferUp for "${searchTerm}"`);
      return items;

    } catch (error) {
      console.error(`❌ Error searching OfferUp for ${searchTerm}:`, error.message);
      return [];
    }
  }

  async searchPoshmark(searchTerm) {
    console.log(`🔍 Searching Poshmark for: ${searchTerm}`);
    
    try {
      await this.page.goto('https://poshmark.com');
      await this.humanDelay();

      // Find search input
      const searchInput = await this.page.waitForSelector('input[placeholder*="Search"]', { timeout: 5000 });
      if (!searchInput) {
        console.log('❌ Could not find Poshmark search box');
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

      console.log(`✅ Found ${items.length} items on Poshmark for "${searchTerm}"`);
      return items;

    } catch (error) {
      console.error(`❌ Error searching Poshmark for ${searchTerm}:`, error.message);
      return [];
    }
  }

  async searchDepop(searchTerm) {
    console.log(`🔍 Searching Depop for: ${searchTerm}`);
    
    try {
      await this.page.goto('https://depop.com');
      await this.humanDelay();

      // Find search input
      const searchInput = await this.page.waitForSelector('input[placeholder*="Search"]', { timeout: 5000 });
      if (!searchInput) {
        console.log('❌ Could not find Depop search box');
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

      console.log(`✅ Found ${items.length} items on Depop for "${searchTerm}"`);
      return items;

    } catch (error) {
      console.error(`❌ Error searching Depop for ${searchTerm}:`, error.message);
      return [];
    }
  }

  async searchEtsy(searchTerm) {
    console.log(`🔍 Searching Etsy for: ${searchTerm}`);
    
    try {
      await this.page.goto('https://etsy.com');
      await this.humanDelay();

      // Find search input
      const searchInput = await this.page.waitForSelector('input[name="search_query"]', { timeout: 5000 });
      if (!searchInput) {
        console.log('❌ Could not find Etsy search box');
        return [];
      }

      await searchInput.fill(searchTerm);
      await searchInput.press('Enter');
      await this.page.waitForLoadState('networkidle');

      // Try to set price filter
      try {
        await this.page.click('text=Price', { timeout: 3000 });
        await this.page.waitForTimeout(2000);
        
        const maxPriceInput = await this.page.$('input[placeholder*="Max"]');
        if (maxPriceInput) {
          await maxPriceInput.fill(this.config.search.maxPricePerItem.toString());
          await this.page.click('text=Apply', { timeout: 2000 });
          await this.page.waitForTimeout(3000);
        }
      } catch (e) {
        console.log('⚠️  Could not set Etsy price filter');
      }

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

      console.log(`✅ Found ${items.length} items on Etsy for "${searchTerm}"`);
      return items;

    } catch (error) {
      console.error(`❌ Error searching Etsy for ${searchTerm}:`, error.message);
      return [];
    }
  }

  async searchShopGoodwill(searchTerm) {
    console.log(`🔍 Searching ShopGoodwill for: ${searchTerm}`);
    
    try {
      await this.page.goto('https://shopgoodwill.com');
      await this.humanDelay();

      // Find search input
      const searchInput = await this.page.waitForSelector('input[name="q"]', { timeout: 5000 });
      if (!searchInput) {
        console.log('❌ Could not find ShopGoodwill search box');
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

      console.log(`✅ Found ${items.length} items on ShopGoodwill for "${searchTerm}"`);
      return items;

    } catch (error) {
      console.error(`❌ Error searching ShopGoodwill for ${searchTerm}:`, error.message);
      return [];
    }
  }

  async downloadImage(imageUrl, filename) {
    try {
      if (!imageUrl) return null;
      
      const response = await this.page.context().request.get(imageUrl);
      const buffer = await response.body();
      
      const imagePath = path.join('sonic_results', 'images', filename);
      if (!fs.existsSync(path.dirname(imagePath))) {
        fs.mkdirSync(path.dirname(imagePath), { recursive: true });
      }
      
      fs.writeFileSync(imagePath, buffer);
      return imagePath;
    } catch (error) {
      console.error('Error downloading image:', error.message);
      return null;
    }
  }

  async analyzeBundles() {
    console.log('\n📊 ANALYZING BUNDLE OPPORTUNITIES...\n');
    
    const bundleOpportunities = [];
    
    for (const bundle of this.config.strategy.bundles) {
      console.log(`\n🎯 Analyzing: ${bundle.name}`);
      console.log(`Target items: ${bundle.items.join(', ')}`);
      
      const availableItems = [];
      
      for (const requiredItem of bundle.items) {
        const matches = this.results.filter(item => 
          item.title.toLowerCase().includes(requiredItem.toLowerCase().split(' ')[0]) &&
          item.title.toLowerCase().includes(requiredItem.toLowerCase().split(' ')[1])
        );
        
        if (matches.length > 0) {
          const bestMatch = matches.sort((a, b) => a.priceNumeric - b.priceNumeric)[0];
          availableItems.push(bestMatch);
          console.log(`  ✅ Found: ${bestMatch.title} - ${bestMatch.price} (${bestMatch.platform})`);
        } else {
          console.log(`  ❌ Missing: ${requiredItem}`);
        }
      }
      
      if (availableItems.length === bundle.items.length) {
        const totalCost = availableItems.reduce((sum, item) => sum + item.priceNumeric, 0);
        const profit = bundle.resaleValue - totalCost;
        const margin = ((profit / totalCost) * 100).toFixed(1);
        
        bundleOpportunities.push({
          bundleName: bundle.name,
          items: availableItems,
          totalCost,
          resaleValue: bundle.resaleValue,
          profit,
          margin: `${margin}%`,
          viable: totalCost <= bundle.targetCost && profit >= (totalCost * 0.5)
        });
        
        console.log(`  💰 Bundle total: $${totalCost.toFixed(2)}`);
        console.log(`  📈 Profit: $${profit.toFixed(2)} (${margin}% margin)`);
        console.log(`  ${totalCost <= bundle.targetCost ? '✅ VIABLE' : '❌ TOO EXPENSIVE'}`);
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
    
    console.log(`\n💾 Results saved to sonic_results/sonic_collectibles_${timestamp}.json`);
    console.log(`📊 CSV saved to sonic_results/sonic_collectibles_${timestamp}.csv`);
  }

  async run() {
    await this.init();
    
    console.log('🚀 Starting Sonic Collectible Bundle Hunt...\n');
    
    // Prompt for Facebook credentials if not set and Facebook is enabled
    if (this.config.facebook.enabled && (!this.config.facebook.email || !this.config.facebook.password)) {
      console.log('📧 Facebook login required for Marketplace search.');
      console.log('You can either:');
      console.log('1. Set FB_EMAIL and FB_PASSWORD environment variables');
      console.log('2. Edit the facebook credentials in config.js');
      console.log('3. Skip Facebook search (press Enter)\n');
      
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
    
    for (const searchTerm of this.config.strategy.targetItems) {
      console.log(`\n🎯 Searching for: ${searchTerm}`);
      
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
        console.log('⏭️  Skipping Facebook Marketplace (not logged in)');
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
    
    // Analyze and save results
    await this.saveResults();
    
    console.log(`\n🎉 Hunt complete! Found ${this.results.length} total items.`);
    console.log('📊 Breakdown by platform:');
    
    const platformCounts = this.results.reduce((acc, item) => {
      acc[item.platform] = (acc[item.platform] || 0) + 1;
      return acc;
    }, {});
    
    Object.entries(platformCounts).forEach(([platform, count]) => {
      console.log(`  ${platform}: ${count} items`);
    });
    
    console.log('\n🌐 Platforms searched:');
    console.log(`  ✅ eBay: ${this.config.platforms.ebay.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  ✅ Mercari: ${this.config.platforms.mercari.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  ✅ Facebook Marketplace (Nationwide): ${this.config.platforms.facebook.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  ✅ OfferUp: ${this.config.platforms.offerup.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  ✅ Poshmark: ${this.config.platforms.poshmark.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  ✅ Depop: ${this.config.platforms.depop.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  ✅ Etsy: ${this.config.platforms.etsy.enabled ? 'Enabled' : 'Disabled'}`);
    console.log(`  ✅ ShopGoodwill: ${this.config.platforms.shopgoodwill.enabled ? 'Enabled' : 'Disabled'}`);
    
    console.log('\n📁 Check the sonic_results folder for detailed data.');
    console.log('📊 Files saved:');
    console.log('  - JSON: ./sonic_results/sonic_collectibles_[date].json');
    console.log('  - CSV: ./sonic_results/sonic_collectibles_[date].csv');
    console.log('  - Images: ./sonic_results/images/');
    
    if (this.config.browser.keepOpen) {
      console.log('\n🔍 Browser will stay open for manual inspection.');
      console.log('Press Ctrl+C to close the browser when done.');
      
      // Keep the browser open indefinitely
      await new Promise(() => {
        // This promise never resolves, keeping the script running
      });
    } else {
      await this.browser.close();
    }
  }
}

// Run the hunter
if (require.main === module) {
  const hunter = new SonicBundleHunter();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    if (hunter.browser) {
      await hunter.browser.close();
    }
    process.exit(0);
  });
  
  hunter.run().catch(error => {
    console.error('❌ Fatal error:', error.message);
    if (hunter.browser) {
      hunter.browser.close();
    }
    process.exit(1);
  });
}

module.exports = SonicBundleHunter;