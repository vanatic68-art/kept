/* Kept — built-in US cancel/manage directory. Patterns match bank merchant strings. */
(function (root) {
  'use strict';
  // cancelUrl: official cancel or manage page when known. phone/inApp: needs call or app.
  // patterns: regex sources matched against normalized merchant text.
  const CATALOG = [
    { id: 'netflix', name: 'Netflix', category: 'Streaming', cancelUrl: 'https://www.netflix.com/cancelplan', patterns: ['NETFLIX'] },
    { id: 'hulu', name: 'Hulu', category: 'Streaming', cancelUrl: 'https://secure.hulu.com/account', patterns: ['HULU'] },
    { id: 'disneyplus', name: 'Disney+', category: 'Streaming', cancelUrl: 'https://www.disneyplus.com/account', patterns: ['DISNEY\\+', 'DISNEYPLUS', 'DISNEY PLUS', 'WALT DISNEY'] },
    { id: 'max', name: 'Max (HBO)', category: 'Streaming', cancelUrl: 'https://auth.max.com/product', patterns: ['\\bMAX\\b', 'HBOMAX', 'HBO MAX', 'HBO\\*'] },
    { id: 'paramountplus', name: 'Paramount+', category: 'Streaming', cancelUrl: 'https://www.paramountplus.com/account/', patterns: ['PARAMOUNT\\+', 'PARAMOUNTPLUS', 'PARAMOUNT PLUS'] },
    { id: 'peacock', name: 'Peacock', category: 'Streaming', cancelUrl: 'https://www.peacocktv.com/account/subscriptions', patterns: ['PEACOCK'] },
    { id: 'appletv', name: 'Apple TV+', category: 'Streaming', cancelUrl: 'https://apps.apple.com/account/subscriptions', altUrl: 'itms-apps://apps.apple.com/account/subscriptions', patterns: ['APPLE\\.COM\\/BILL', 'APPLE TV', 'ITUNES\\.COM\\/BILL'], note: 'Often billed through Apple — cancel in Settings › [your name] › Subscriptions.' },
    { id: 'amazontv', name: 'Prime Video / Amazon channels', category: 'Streaming', cancelUrl: 'https://www.amazon.com/gp/video/settings', patterns: ['AMZN DIGITAL', 'AMAZON VIDEO', 'AMAZON PRIME VIDEO', 'PRIME VIDEO'] },
    { id: 'youtubetv', name: 'YouTube TV', category: 'Streaming', cancelUrl: 'https://tv.youtube.com/account', patterns: ['YOUTUBE TV', 'YOUTUBETV', 'GOOGLE\\*YOUTUBETV'] },
    { id: 'youtubepremium', name: 'YouTube Premium', category: 'Streaming', cancelUrl: 'https://www.youtube.com/paid_memberships', patterns: ['YOUTUBE PREMIUM', 'GOOGLE\\*YOUTUBE', 'YOUTUBE\\*'] },
    { id: 'espnplus', name: 'ESPN+', category: 'Streaming', cancelUrl: 'https://plus.espn.com/account', patterns: ['ESPN\\+', 'ESPNPLUS', 'ESPN PLUS'] },
    { id: 'discoveryplus', name: 'Discovery+', category: 'Streaming', cancelUrl: 'https://www.discoveryplus.com/account', patterns: ['DISCOVERY\\+', 'DISCOVERYPLUS', 'DISCOVERY PLUS'] },
    { id: 'crunchyroll', name: 'Crunchyroll', category: 'Streaming', cancelUrl: 'https://www.crunchyroll.com/account/membership', patterns: ['CRUNCHYROLL'] },
    { id: 'fubo', name: 'fuboTV', category: 'Streaming', cancelUrl: 'https://www.fubo.tv/welcome/account', patterns: ['FUBO'] },
    { id: 'xfinity', name: 'Xfinity / Comcast', category: 'Streaming', cancelUrl: 'https://www.xfinity.com/support/articles/cancel-service-options', patterns: ['COMCAST', 'XFINITY'], note: 'Internet/cable often requires calling or chatting with Xfinity to cancel.', phone: true },
    { id: 'spectrum', name: 'Spectrum', category: 'Streaming', cancelUrl: 'https://www.spectrum.net/support/account-billing/cancel-spectrum', patterns: ['SPECTRUM', 'CHARTER COMM'], note: 'Usually cancel by phone or chat.', phone: true },
    { id: 'att', name: 'AT&T TV / DirecTV', category: 'Streaming', cancelUrl: 'https://www.att.com/support/article/directv-stream/KM1065827/', patterns: ['\\bAT&T\\b', '\\bATT\\b', 'DIRECTV', 'DIRTV'], note: 'Often requires a phone call.', phone: true },
    { id: 'dish', name: 'DISH', category: 'Streaming', cancelUrl: 'https://www.dish.com/help/account/', patterns: ['DISH NETWORK', 'DISH\\*'], note: 'Usually cancel by phone.', phone: true },
    { id: 'sling', name: 'Sling TV', category: 'Streaming', cancelUrl: 'https://www.sling.com/account', patterns: ['SLING'] },
    { id: 'starz', name: 'STARZ', category: 'Streaming', cancelUrl: 'https://www.starz.com/account', patterns: ['STARZ'] },
    { id: 'showtime', name: 'Paramount+ with SHOWTIME', category: 'Streaming', cancelUrl: 'https://www.paramountplus.com/account/', patterns: ['SHOWTIME'] },
    { id: 'britbox', name: 'BritBox', category: 'Streaming', cancelUrl: 'https://www.britbox.com/us/account', patterns: ['BRITBOX'] },
    { id: 'mlb', name: 'MLB.TV', category: 'Streaming', cancelUrl: 'https://www.mlb.com/live-stream-games/subscribe', patterns: ['MLB\\.TV', 'MLB TV', 'MLBTV'] },
    { id: 'nflplus', name: 'NFL+', category: 'Streaming', cancelUrl: 'https://www.nfl.com/plus/', patterns: ['NFL\\+', 'NFLPLUS', 'NFL GAME PASS'] },

    { id: 'spotify', name: 'Spotify', category: 'Music', cancelUrl: 'https://www.spotify.com/account/subscription/', patterns: ['SPOTIFY'] },
    { id: 'applemusic', name: 'Apple Music', category: 'Music', cancelUrl: 'https://apps.apple.com/account/subscriptions', altUrl: 'itms-apps://apps.apple.com/account/subscriptions', patterns: ['APPLE MUSIC', 'APPLE\\.COM\\/BILL.*MUSIC'], note: 'Cancel in Settings › [your name] › Subscriptions on iPhone.' },
    { id: 'amazonmusic', name: 'Amazon Music', category: 'Music', cancelUrl: 'https://www.amazon.com/gp/music/settings', patterns: ['AMAZON MUSIC', 'AMZN MUSIC'] },
    { id: 'pandora', name: 'Pandora', category: 'Music', cancelUrl: 'https://www.pandora.com/account/subscription', patterns: ['PANDORA'] },
    { id: 'tidal', name: 'TIDAL', category: 'Music', cancelUrl: 'https://tidal.com/account', patterns: ['TIDAL'] },
    { id: 'siriusxm', name: 'SiriusXM', category: 'Music', cancelUrl: 'https://care.siriusxm.com/login_view.action', patterns: ['SIRIUSXM', 'SIRIUS XM', 'SIRIUSXM\\.COM'] },
    { id: 'audible', name: 'Audible', category: 'Music', cancelUrl: 'https://www.amazon.com/hz/mycd/myx#/home/settings/pplsettings', patterns: ['AUDIBLE'] },
    { id: 'iheartradio', name: 'iHeartRadio', category: 'Music', cancelUrl: 'https://www.iheart.com/my/account/', patterns: ['IHEART', 'I HEART RADIO'] },

    { id: 'amazonprime', name: 'Amazon Prime', category: 'Shopping', cancelUrl: 'https://www.amazon.com/gp/primecentral', patterns: ['AMAZON PRIME', 'AMZN\\.COM\\/BILL', 'AMAZON\\.COM\\*PRIME', 'AMAZON PRIME\\*'] },
    { id: 'walmartplus', name: 'Walmart+', category: 'Shopping', cancelUrl: 'https://www.walmart.com/plus/manage-membership', patterns: ['WALMART\\+', 'WALMARTPLUS', 'WALMART PLUS'] },
    { id: 'costco', name: 'Costco membership', category: 'Shopping', cancelUrl: 'https://www.costco.com/membership-offerings.html', patterns: ['COSTCO\\.COM.*MEMBER', 'COSTCO MEMBERSHIP'], note: 'Membership renewals — cancel/renew at membership desk or online account.' },
    { id: 'samsclub', name: "Sam's Club", category: 'Shopping', cancelUrl: 'https://www.samsclub.com/content/membership', patterns: ['SAMS CLUB', "SAM'S CLUB", 'SAMSCLUB'] },

    { id: 'apple', name: 'Apple (App Store / iCloud)', category: 'Apps', cancelUrl: 'https://apps.apple.com/account/subscriptions', altUrl: 'itms-apps://apps.apple.com/account/subscriptions', patterns: ['APPLE\\.COM\\/BILL', 'ITUNES\\.COM', 'ICLOUD\\.COM', 'APPLE\\.COM BILL'], note: 'On iPhone you can also go to Settings › [your name] › Subscriptions.' },
    { id: 'googleplay', name: 'Google Play subscriptions', category: 'Apps', cancelUrl: 'https://play.google.com/store/account/subscriptions', altUrl: 'intent://play.google.com/store/account/subscriptions#Intent;scheme=https;package=com.android.vending;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Faccount%2Fsubscriptions;end', patterns: ['GOOGLEPLAY', 'GOOGLE \\*GOOGLE PLAY', 'GOOGLE \\*PLAY', 'GOOGLE \\*'], note: 'Cancels any app billed through Google Play. If the page times out, open the Play Store app once, then tap again.' },
    { id: 'microsoft365', name: 'Microsoft 365', category: 'Software', cancelUrl: 'https://account.microsoft.com/services', patterns: ['MICROSOFT\\*365', 'MICROSOFT 365', 'MSFT \\*', 'OFFICE 365', 'MICROSOFT\\*OFFICE'] },
    { id: 'adobe', name: 'Adobe', category: 'Software', cancelUrl: 'https://account.adobe.com/plans', patterns: ['ADOBE', 'ADBE \\*'] },
    { id: 'dropbox', name: 'Dropbox', category: 'Software', cancelUrl: 'https://www.dropbox.com/account/plan', patterns: ['DROPBOX'] },
    { id: 'notion', name: 'Notion', category: 'Software', cancelUrl: 'https://www.notion.so/my-account', patterns: ['NOTION'] },
    { id: 'evernote', name: 'Evernote', category: 'Software', cancelUrl: 'https://www.evernote.com/Settings.action', patterns: ['EVERNOTE'] },
    { id: '1password', name: '1Password', category: 'Software', cancelUrl: 'https://my.1password.com/profile', patterns: ['1PASSWORD', 'ONEPASSWORD'] },
    { id: 'lastpass', name: 'LastPass', category: 'Software', cancelUrl: 'https://lastpass.com/account.php', patterns: ['LASTPASS'] },
    { id: 'norton', name: 'Norton', category: 'Software', cancelUrl: 'https://my.norton.com/', patterns: ['NORTON', 'SYMANTEC'] },
    { id: 'mcafee', name: 'McAfee', category: 'Software', cancelUrl: 'https://home.mcafee.com/Secure/MyAccount.aspx', patterns: ['MCAFEE'] },
    { id: 'grammarly', name: 'Grammarly', category: 'Software', cancelUrl: 'https://account.grammarly.com/', patterns: ['GRAMMARLY'] },
    { id: 'canva', name: 'Canva Pro', category: 'Software', cancelUrl: 'https://www.canva.com/settings/billing-and-teams', patterns: ['CANVA'] },
    { id: 'zoom', name: 'Zoom', category: 'Software', cancelUrl: 'https://zoom.us/billing', patterns: ['ZOOM\\.US', 'ZOOM\\.COM'] },
    { id: 'linkedin', name: 'LinkedIn Premium', category: 'Software', cancelUrl: 'https://www.linkedin.com/premium/my-premium/', patterns: ['LINKEDIN'] },
    { id: 'chatgpt', name: 'ChatGPT Plus', category: 'Software', cancelUrl: 'https://chatgpt.com/#settings', patterns: ['OPENAI', 'CHATGPT', 'OPENAI \\*CHATGPT'] },
    { id: 'github', name: 'GitHub', category: 'Software', cancelUrl: 'https://github.com/settings/billing', patterns: ['GITHUB'] },

    { id: 'planetfitness', name: 'Planet Fitness', category: 'Fitness', cancelUrl: 'https://www.planetfitness.com/gym-membership-cancel', patterns: ['PLANET FITNESS', 'PLANETFITNESS', 'PF BLACK CARD'], note: 'Often must cancel in person at your home club or by certified letter — check the PF page.', phone: true },
    { id: 'lafitness', name: 'LA Fitness', category: 'Fitness', cancelUrl: 'https://www.lafitness.com/Pages/faq.aspx', patterns: ['LA FITNESS', 'LAFITNESS'], note: 'Usually cancel in person or by mail to your club.', phone: true },
    { id: 'anytimefitness', name: 'Anytime Fitness', category: 'Fitness', cancelUrl: 'https://www.anytimefitness.com/contact/', patterns: ['ANYTIME FITNESS'], note: 'Contact your home club to cancel.', phone: true },
    { id: 'orangetheory', name: 'OrangeTheory', category: 'Fitness', cancelUrl: 'https://www.orangetheory.com/', patterns: ['ORANGETHEORY', 'ORANGE THEORY'], note: 'Cancel with your studio.', phone: true },
    { id: 'classpass', name: 'ClassPass', category: 'Fitness', cancelUrl: 'https://classpass.com/settings/membership', patterns: ['CLASSPASS'] },
    { id: 'peloton', name: 'Peloton', category: 'Fitness', cancelUrl: 'https://www.onepeloton.com/memberships-and-subscriptions', patterns: ['PELOTON'] },
    { id: 'fitbit', name: 'Fitbit Premium', category: 'Fitness', cancelUrl: 'https://www.fitbit.com/settings/profile', patterns: ['FITBIT PREMIUM', 'FITBIT\\.COM'] },

    { id: 'hellofresh', name: 'HelloFresh', category: 'Meal kits', cancelUrl: 'https://www.hellofresh.com/account-settings/subscription-settings', patterns: ['HELLOFRESH', 'HELLO FRESH'] },
    { id: 'blueapron', name: 'Blue Apron', category: 'Meal kits', cancelUrl: 'https://www.blueapron.com/users/account', patterns: ['BLUE APRON', 'BLUEAPRON'] },
    { id: 'factor', name: 'Factor', category: 'Meal kits', cancelUrl: 'https://www.factor75.com/account', patterns: ['FACTOR75', 'FACTOR MEALS', 'FACTOR \\*'] },
    { id: 'homechef', name: 'Home Chef', category: 'Meal kits', cancelUrl: 'https://www.homechef.com/account', patterns: ['HOME CHEF', 'HOMECHEF'] },
    { id: 'doordash', name: 'DoorDash DashPass', category: 'Meal kits', cancelUrl: 'https://www.doordash.com/consumer/edit_profile/', patterns: ['DOORDASH\\*DASHPASS', 'DASHPASS', 'DOORDASH DASHPASS'] },
    { id: 'ubereats', name: 'Uber One', category: 'Meal kits', cancelUrl: 'https://account.uber.com/', patterns: ['UBER \\*ONE', 'UBERONE', 'UBER PASS'] },

    { id: 'nytimes', name: 'The New York Times', category: 'News', cancelUrl: 'https://myaccount.nytimes.com/segment/subscription', patterns: ['NYTIMES', 'NEW YORK TIMES', 'NY TIMES'] },
    { id: 'wsj', name: 'Wall Street Journal', category: 'News', cancelUrl: 'https://customercenter.wsj.com/', patterns: ['WSJ\\.COM', 'WALL STREET JOURNAL', 'DOW JONES'] },
    { id: 'washingtonpost', name: 'Washington Post', category: 'News', cancelUrl: 'https://subscribe.washingtonpost.com/', patterns: ['WASHINGTON POST', 'WAPO'] },
    { id: 'applearcade', name: 'Apple Arcade', category: 'Apps', cancelUrl: 'https://apps.apple.com/account/subscriptions', altUrl: 'itms-apps://apps.apple.com/account/subscriptions', patterns: ['APPLE ARCADE'] },
    { id: 'appleone', name: 'Apple One', category: 'Apps', cancelUrl: 'https://apps.apple.com/account/subscriptions', altUrl: 'itms-apps://apps.apple.com/account/subscriptions', patterns: ['APPLE ONE'] },
    { id: 'xboxgamepass', name: 'Xbox Game Pass', category: 'Apps', cancelUrl: 'https://account.microsoft.com/services', patterns: ['XBOX', 'GAME PASS', 'MICROSOFT\\*XBOX'] },
    { id: 'playstationplus', name: 'PlayStation Plus', category: 'Apps', cancelUrl: 'https://www.playstation.com/acct/subscriptions', patterns: ['PLAYSTATION', 'SONY PLAYSTATION', 'PSN '] },
    { id: 'nintendoonline', name: 'Nintendo Switch Online', category: 'Apps', cancelUrl: 'https://accounts.nintendo.com/', patterns: ['NINTENDO'] },
    { id: 'rocketmoney', name: 'Rocket Money', category: 'Other', cancelUrl: 'https://members.rocketmoney.com/', patterns: ['ROCKET MONEY', 'ROCKETMONEY', 'TRUEBILL'] },
    { id: 'identityguard', name: 'Identity / credit monitoring', category: 'Other', cancelUrl: null, patterns: ['LIFETOCK', 'LIFETOLOCK', 'IDENTITY GUARD', 'IDSHIELD', 'AURA\\.COM'], note: 'Check your email receipt for the company login — cancel in their account settings.' },
    { id: 'ancestry', name: 'Ancestry', category: 'Other', cancelUrl: 'https://www.ancestry.com/account', patterns: ['ANCESTRY'] },
    { id: '23andme', name: '23andMe', category: 'Other', cancelUrl: 'https://you.23andme.com/user/', patterns: ['23ANDME'] },
    { id: 'patreon', name: 'Patreon', category: 'Other', cancelUrl: 'https://www.patreon.com/settings/memberships', patterns: ['PATREON'] },
    { id: 'onlyfans', name: 'OnlyFans', category: 'Other', cancelUrl: 'https://onlyfans.com/my/settings/subscription', patterns: ['ONLYFANS'] },
    { id: 'cashappboost', name: 'Cash App Afterpay / Boosts', category: 'Other', cancelUrl: 'https://cash.app/help/', patterns: ['CASH APP\\*'], note: 'Not always a subscription — check Cash App for recurring payments.' },
  ];

  function match(merchantNorm) {
    const t = String(merchantNorm || '').toUpperCase();
    for (const c of CATALOG) {
      for (const p of c.patterns) {
        try { if (new RegExp(p, 'i').test(t)) return c; } catch (e) { /* skip bad pattern */ }
      }
    }
    return null;
  }
  function search(q) {
    const n = String(q || '').trim().toLowerCase();
    if (!n) return CATALOG.slice();
    return CATALOG.filter(c => c.name.toLowerCase().includes(n) || c.category.toLowerCase().includes(n) || c.patterns.some(p => p.toLowerCase().includes(n)));
  }
  function byId(id) { return CATALOG.find(c => c.id === id) || null; }
  function googleCancel(name) {
    return 'https://www.google.com/search?q=' + encodeURIComponent('how to cancel ' + name + ' subscription');
  }

  const api = { CATALOG, match, search, byId, googleCancel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.KeptCancel = api;
})(typeof window !== 'undefined' ? window : globalThis);
