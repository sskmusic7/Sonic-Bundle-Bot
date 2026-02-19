# Sonic Bundle Bot - Nationwide Collectibles Hunter

A powerful automated bot for hunting Sonic the Hedgehog collectibles across multiple platforms nationwide, with a focus on finding bundle opportunities for resale profit.

## 🌟 New Features

### 🗺️ Nationwide Facebook Marketplace Search
- **Nationwide Coverage**: Searches Facebook Marketplace across the entire United States, not just local areas
- **Expanded Results**: Increased search radius and result limits for better coverage
- **Location Filtering**: Automatically sets search to "Nationwide" or "Anywhere" for maximum reach

### 🛍️ New Niche Sites Added
The bot now searches these additional platforms for collectibles:

- **OfferUp** - Local marketplace with great deals
- **Poshmark** - Fashion and collectibles marketplace  
- **Depop** - Youth-focused resale platform
- **Etsy** - Handmade and vintage items
- **ShopGoodwill** - Thrift store online auctions
- **Shopify Stores** - Independent online stores

## 🎯 Target Items

The bot searches for these Sonic collectibles:
- GE Sonic plush
- GE Shadow plush
- GE Tails plush  
- GE Knuckles plush
- Boom8 Sonic figure
- Boom8 Shadow figure

## 💰 Bundle Strategy

### Hero Team Plush Pack
- **Items**: GE Sonic Plush + GE Tails Plush + GE Knuckles Plush
- **Target Cost**: $60
- **Resale Value**: $120
- **Profit Margin**: 100%

### Shadow & Rivals Collector Set
- **Items**: GE Shadow Plush + GE Sonic Plush + Boom8 Shadow Figure
- **Target Cost**: $70
- **Resale Value**: $145
- **Profit Margin**: 107%

## 🚀 Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Facebook Login** (Optional)
   - Set `FB_EMAIL` and `FB_PASSWORD` environment variables, OR
   - Edit `config.js` with your Facebook credentials

3. **Run the Bot**
   ```bash
   node sonic_bundle_hunter.js
   ```

## ⚙️ Configuration

Edit `config.js` to customize:

### Search Settings
- `maxPricePerItem`: Maximum price per item ($25 default)
- `searchDelay`: Delay between searches (3 seconds default)
- `nationwideSearch`: Enable nationwide Facebook search

### Platform Settings
Enable/disable platforms in `config.platforms`:
```javascript
platforms: {
  ebay: { enabled: true },
  mercari: { enabled: true },
  facebook: { enabled: true, nationwideSearch: true },
  offerup: { enabled: true },
  poshmark: { enabled: true },
  depop: { enabled: true },
  etsy: { enabled: true },
  shopgoodwill: { enabled: true }
}
```

## 📊 Results

The bot generates:
- **JSON Report**: Detailed data with bundle analysis
- **CSV Export**: Easy spreadsheet viewing
- **Image Downloads**: Product images saved locally
- **Bundle Analysis**: Profit calculations and viability assessment

## 🔧 Advanced Features

### Human-like Behavior
- Random delays between actions
- Natural typing patterns
- Respectful server interaction

### Error Handling
- Graceful platform failures
- Retry mechanisms
- Detailed error logging

### Bundle Analysis
- Automatic profit calculation
- Margin percentage analysis
- Viability assessment
- Cost vs. target comparison

## 📁 File Structure

```
Sonic Bundle Bot/
├── sonic_bundle_hunter.js    # Main bot script
├── config.js                 # Configuration file
├── package.json              # Dependencies
├── README.md                 # This file
└── sonic_results/           # Generated results
    ├── images/              # Downloaded product images
    ├── sonic_collectibles_[date].json  # Detailed JSON report
    └── sonic_collectibles_[date].csv   # CSV export
```

## 🛡️ Safety Features

- **Rate Limiting**: Respectful delays between requests
- **Error Recovery**: Continues searching if one platform fails
- **Data Validation**: Ensures price and item quality
- **Graceful Shutdown**: Clean browser closure on exit

## 💡 Tips for Best Results

1. **Facebook Login**: Enable for nationwide Marketplace access
2. **Price Limits**: Adjust `maxPricePerItem` based on your budget
3. **Platform Selection**: Enable/disable platforms based on your preferences
4. **Bundle Focus**: Monitor the bundle analysis for profit opportunities
5. **Regular Runs**: Run daily for fresh inventory discovery

## 🔄 Updates

### Latest Changes
- ✅ Nationwide Facebook Marketplace search
- ✅ Added 6 new niche platforms
- ✅ Enhanced bundle analysis
- ✅ Improved error handling
- ✅ Better result formatting

## 📞 Support

For issues or questions:
1. Check the console output for error messages
2. Verify your configuration in `config.js`
3. Ensure all dependencies are installed
4. Check your internet connection

---

**Happy Hunting! 🦔💰** 