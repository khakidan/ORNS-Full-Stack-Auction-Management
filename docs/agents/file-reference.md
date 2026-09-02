# File Reference & Directory Structure

This document details the decoupled, highly structured layout of the **ORNS Charity Auction Manager** codebase.

---

## Codebase Topography

```
├── README.md                  # High-level overview and stack definition
├── package.json               # Dependencies, build pipeline, and execution script declarations
├── tsconfig.json              # TypeScript compilation specifications
├── vite.config.ts             # React build pipeline, asset code-splitting, and server proxies
├── server.ts                  # Clean Express entry point and bootstrap manager
│
├── server/                    # Express Backend Layer
│   ├── boot.ts                # Server creation and static file matrix directories
│   ├── app.ts                 # Express application, routes assembly, and global middlewares
│   │
│   ├── routes/                # Isolated REST Endpoint Pathways
│   │   ├── authRoutes.ts      # Administrative sign-in and OAuth handlers
│   │   ├── bidRoutes.ts       # Critical live-event transactional bid bindings
│   │   ├── bundleRoutes.ts    # Bundling management and creation workflows
│   │   ├── dataRoutes.ts      # Syncing operations and Google Sheets interactions
│   │   ├── health.ts          # Endpoint health checking
│   │   ├── productionRoutes.ts# Static file assets router for production
│   │   ├── receiptRoutes.ts   # Receipt generation and email pathways
│   │   └── setupRoutes.ts     # Initial spreadsheet bootstrap rules
│   │
│   ├── services/              # Singleton Service Providers
│   │   ├── assistantService.ts# Gemini assistant interactions and parsing logic
│   │   ├── genai.ts           # Google GenAI model loading and SDK configurations
│   │   ├── google.ts          # Resilient Google Sheets API wrappers with retry-backoff
│   │   └── paypal.ts          # PayPal transaction fee calculations
│   │
│   ├── middleware/            # Request Interceptors
│   │   ├── auth.ts            # Restricted domain guards and token verification
│   │   ├── cache.ts           # Prevent intermediate cache headers on secure endpoints
│   │   └── session.ts         # Session recovery and cookie validation
│   │
│   └── utils/                 # Utility Libraries
│       ├── sheets.ts          # Grid cells mapping and format conversions
│       └── crypto.ts          # Encryption helpers and state checks
│
└── src/                       # Frontend React Layer
    ├── main.tsx               # Primary application mounting point
    ├── App.tsx                # Main layout shell, router, and core context state
    ├── index.css              # Global styles importing Tailwind CSS
    │
    ├── context/               # React Context Providers
    │   └── ConfigContext.tsx  # Shared configuration variables and state sync hooks
    │
    ├── lib/                   # Internal Integration Clients
    │   └── firebase.ts        # Cloud Firestore references and Auth init
    │
    └── components/            # High-Performance UI Views and Test Suites
        ├── ui/                # Small reusable styling components (buttons, input, sheet)
        ├── Dashboard.tsx      # Real-time event logging, fund charts, and key stats
        ├── Bidders.tsx        # Guest checking, search filters, and bidder allocations
        ├── BidEntry.tsx       # Live numpad input widget for high-speed auction logging
        ├── Items.tsx          # Item creation, listings, and category sorting
        ├── BundlingDialog.tsx # Interactive overlay for bundling constituent items
        ├── Receipts.tsx       # Invoice templates, receipts overview, and printing rules
        └── Checkout.tsx       # PayPal checkouts, transaction listings, and email triggers
```
