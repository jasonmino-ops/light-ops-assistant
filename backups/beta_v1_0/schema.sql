--
-- PostgreSQL database dump
--

\restrict hXvLsbnSzaln3WEzfK8mCE9pNfbBq0PpuK4ZStsdTHvz0sgt5BJUNlwanK1urFG

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: LogStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."LogStatus" AS ENUM (
    'SUCCESS',
    'FAILED'
);


--
-- Name: PaymentMethod; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PaymentMethod" AS ENUM (
    'CASH',
    'KHQR'
);


--
-- Name: PaymentStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."PaymentStatus" AS ENUM (
    'PENDING',
    'PAID',
    'FAILED',
    'EXPIRED',
    'CANCELLED'
);


--
-- Name: ProductStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ProductStatus" AS ENUM (
    'ACTIVE',
    'DISABLED'
);


--
-- Name: RecordStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."RecordStatus" AS ENUM (
    'COMPLETED',
    'CANCELLED',
    'PENDING_PAYMENT'
);


--
-- Name: SaleType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SaleType" AS ENUM (
    'SALE',
    'REFUND'
);


--
-- Name: StoreStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."StoreStatus" AS ENUM (
    'ACTIVE',
    'DISABLED'
);


--
-- Name: UserRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."UserRole" AS ENUM (
    'OWNER',
    'STAFF'
);


--
-- Name: UserStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."UserStatus" AS ENUM (
    'ACTIVE',
    'DISABLED'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: BindToken; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."BindToken" (
    id text NOT NULL,
    token text NOT NULL,
    "tenantId" text NOT NULL,
    "storeId" text NOT NULL,
    role public."UserRole" NOT NULL,
    label text,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "maxUses" integer DEFAULT 1 NOT NULL,
    "usedCount" integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: CustomerOrder; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."CustomerOrder" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "storeId" text NOT NULL,
    "storeCode" text NOT NULL,
    "orderNo" text NOT NULL,
    "customerTelegramId" text,
    "itemsJson" text NOT NULL,
    "totalAmount" numeric(12,2) NOT NULL,
    status text DEFAULT 'PENDING'::text NOT NULL,
    remark text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "paymentStatus" character varying(20) DEFAULT 'UNPAID'::character varying NOT NULL,
    "paymentMethod" character varying(20),
    "paidAt" timestamp(3) without time zone,
    "paidAmount" numeric(12,2)
);


--
-- Name: KhqrConfigSession; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."KhqrConfigSession" (
    "telegramId" text NOT NULL,
    "tenantId" text,
    phase text DEFAULT 'AWAITING_IMAGE'::text NOT NULL,
    "fileId" text,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: MerchantPaymentConfig; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."MerchantPaymentConfig" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "storeId" text,
    provider text DEFAULT 'BAKONG_KHQR'::text NOT NULL,
    "merchantId" text,
    "merchantName" text,
    "merchantAccountRef" text,
    currency text DEFAULT 'USD'::text NOT NULL,
    "khqrEnabled" boolean DEFAULT true NOT NULL,
    "isDefault" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "khqrImageUrl" text,
    "uploadedByUserId" text
);


--
-- Name: OperationLog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OperationLog" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "storeId" text,
    "userId" text,
    "actionType" text NOT NULL,
    "targetType" text NOT NULL,
    "targetId" text,
    "requestId" text,
    status public."LogStatus" NOT NULL,
    message text,
    "payloadSnapshot" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "saleRecordId" text
);


--
-- Name: OpsAdmin; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."OpsAdmin" (
    id text NOT NULL,
    name text NOT NULL,
    username text NOT NULL,
    "passwordHash" text,
    "telegramId" text,
    role text DEFAULT 'OPS_ADMIN'::text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: PaymentIntent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."PaymentIntent" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "storeId" text NOT NULL,
    "operatorUserId" text NOT NULL,
    "orderNo" text NOT NULL,
    "paymentMethod" public."PaymentMethod" NOT NULL,
    status public."PaymentStatus" DEFAULT 'PENDING'::public."PaymentStatus" NOT NULL,
    amount numeric(12,2) NOT NULL,
    "khqrPayload" text,
    "paidAt" timestamp(3) without time zone,
    "cancelledAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    provider text,
    "merchantConfigId" text
);


--
-- Name: Product; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Product" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    barcode text NOT NULL,
    sku text,
    name text NOT NULL,
    spec text,
    "sellPrice" numeric(12,2) NOT NULL,
    status public."ProductStatus" DEFAULT 'ACTIVE'::public."ProductStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "categoryId" text,
    "imageUrl" text,
    "imageStorageKey" text,
    "imageUpdatedAt" timestamp(3) without time zone
);


--
-- Name: ProductCategory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ProductCategory" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    name text NOT NULL,
    "parentId" text,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: ProductImportSession; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."ProductImportSession" (
    "telegramId" text NOT NULL,
    "tenantId" text,
    phase text DEFAULT 'AWAITING_DATA'::text NOT NULL,
    "pendingRows" text DEFAULT '[]'::text NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: SaleRecord; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SaleRecord" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "storeId" text NOT NULL,
    "operatorUserId" text NOT NULL,
    "recordNo" text NOT NULL,
    "saleType" public."SaleType" NOT NULL,
    status public."RecordStatus" DEFAULT 'COMPLETED'::public."RecordStatus" NOT NULL,
    "productId" text,
    barcode text NOT NULL,
    "productNameSnapshot" text NOT NULL,
    "specSnapshot" text,
    "unitPrice" numeric(12,2) NOT NULL,
    quantity numeric(12,2) NOT NULL,
    "lineAmount" numeric(12,2) NOT NULL,
    "originalSaleRecordId" text,
    "refundedQty" numeric(12,2),
    "refundReason" text,
    remark text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "orderNo" text
);


--
-- Name: Store; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Store" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    status public."StoreStatus" DEFAULT 'ACTIVE'::public."StoreStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "checkoutMode" text DEFAULT 'DIRECT_PAYMENT'::text NOT NULL,
    "bannerUrl" text,
    announcement text,
    "promoText" text,
    "bannerData" text
);


--
-- Name: StoreApplication; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."StoreApplication" (
    id text NOT NULL,
    "storeName" text NOT NULL,
    "ownerName" text NOT NULL,
    "telegramId" text NOT NULL,
    "telegramUsername" text,
    status text DEFAULT 'PENDING'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "approvedAt" timestamp(3) without time zone,
    "tenantId" text,
    "bindTokenValue" text,
    note text
);


--
-- Name: StoreCustomerContact; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."StoreCustomerContact" (
    id text NOT NULL,
    "tenantId" text,
    "storeCode" text NOT NULL,
    "telegramId" text NOT NULL,
    "telegramUsername" text,
    "telegramFirstName" text,
    "telegramLastName" text,
    "telegramLanguageCode" text,
    "lastOrderId" text,
    source text DEFAULT 'telegram_bind_after_order'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    "firstBoundAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastSeenAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: StoreDailySummary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."StoreDailySummary" (
    id text NOT NULL,
    date text NOT NULL,
    "tenantId" text NOT NULL,
    "storeId" text NOT NULL,
    "salesCount" integer DEFAULT 0 NOT NULL,
    "refundCount" integer DEFAULT 0 NOT NULL,
    "grossSales" numeric(12,2) DEFAULT 0 NOT NULL,
    "refundAmount" numeric(12,2) DEFAULT 0 NOT NULL,
    "netSales" numeric(12,2) DEFAULT 0 NOT NULL,
    "computedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: SupportSession; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."SupportSession" (
    "telegramId" text NOT NULL,
    "tenantId" text,
    "sessionState" text DEFAULT 'auto_active'::text NOT NULL,
    language text DEFAULT 'zh'::text NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: TelegramMessage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TelegramMessage" (
    id text NOT NULL,
    "tenantId" text,
    "recipientTelegramId" text NOT NULL,
    "messageType" text DEFAULT 'TEXT'::text NOT NULL,
    content text NOT NULL,
    status text DEFAULT 'SENT'::text NOT NULL,
    "errorMessage" text,
    "sentBy" text DEFAULT 'SYSTEM'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "senderName" text
);


--
-- Name: Tenant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."Tenant" (
    id text NOT NULL,
    name text NOT NULL,
    status text DEFAULT 'ACTIVE'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    tier text DEFAULT 'LITE'::text NOT NULL
);


--
-- Name: TenantDailySummary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."TenantDailySummary" (
    id text NOT NULL,
    date text NOT NULL,
    "tenantId" text NOT NULL,
    "salesCount" integer DEFAULT 0 NOT NULL,
    "refundCount" integer DEFAULT 0 NOT NULL,
    "grossSales" numeric(12,2) DEFAULT 0 NOT NULL,
    "refundAmount" numeric(12,2) DEFAULT 0 NOT NULL,
    "netSales" numeric(12,2) DEFAULT 0 NOT NULL,
    "computedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: User; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."User" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    username text NOT NULL,
    "displayName" text NOT NULL,
    role public."UserRole" NOT NULL,
    status public."UserStatus" DEFAULT 'ACTIVE'::public."UserStatus" NOT NULL,
    "telegramId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "staffNumber" integer
);


--
-- Name: UserStoreRole; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public."UserStoreRole" (
    id text NOT NULL,
    "tenantId" text NOT NULL,
    "userId" text NOT NULL,
    "storeId" text NOT NULL,
    role public."UserRole" NOT NULL,
    status public."UserStatus" DEFAULT 'ACTIVE'::public."UserStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


--
-- Name: BindToken BindToken_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BindToken"
    ADD CONSTRAINT "BindToken_pkey" PRIMARY KEY (id);


--
-- Name: CustomerOrder CustomerOrder_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."CustomerOrder"
    ADD CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY (id);


--
-- Name: KhqrConfigSession KhqrConfigSession_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."KhqrConfigSession"
    ADD CONSTRAINT "KhqrConfigSession_pkey" PRIMARY KEY ("telegramId");


--
-- Name: MerchantPaymentConfig MerchantPaymentConfig_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."MerchantPaymentConfig"
    ADD CONSTRAINT "MerchantPaymentConfig_pkey" PRIMARY KEY (id);


--
-- Name: OperationLog OperationLog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationLog"
    ADD CONSTRAINT "OperationLog_pkey" PRIMARY KEY (id);


--
-- Name: OpsAdmin OpsAdmin_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OpsAdmin"
    ADD CONSTRAINT "OpsAdmin_pkey" PRIMARY KEY (id);


--
-- Name: PaymentIntent PaymentIntent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PaymentIntent"
    ADD CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY (id);


--
-- Name: ProductCategory ProductCategory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProductCategory"
    ADD CONSTRAINT "ProductCategory_pkey" PRIMARY KEY (id);


--
-- Name: ProductImportSession ProductImportSession_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProductImportSession"
    ADD CONSTRAINT "ProductImportSession_pkey" PRIMARY KEY ("telegramId");


--
-- Name: Product Product_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_pkey" PRIMARY KEY (id);


--
-- Name: SaleRecord SaleRecord_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SaleRecord"
    ADD CONSTRAINT "SaleRecord_pkey" PRIMARY KEY (id);


--
-- Name: StoreApplication StoreApplication_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StoreApplication"
    ADD CONSTRAINT "StoreApplication_pkey" PRIMARY KEY (id);


--
-- Name: StoreCustomerContact StoreCustomerContact_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StoreCustomerContact"
    ADD CONSTRAINT "StoreCustomerContact_pkey" PRIMARY KEY (id);


--
-- Name: StoreDailySummary StoreDailySummary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."StoreDailySummary"
    ADD CONSTRAINT "StoreDailySummary_pkey" PRIMARY KEY (id);


--
-- Name: Store Store_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Store"
    ADD CONSTRAINT "Store_pkey" PRIMARY KEY (id);


--
-- Name: SupportSession SupportSession_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SupportSession"
    ADD CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("telegramId");


--
-- Name: TelegramMessage TelegramMessage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TelegramMessage"
    ADD CONSTRAINT "TelegramMessage_pkey" PRIMARY KEY (id);


--
-- Name: TenantDailySummary TenantDailySummary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."TenantDailySummary"
    ADD CONSTRAINT "TenantDailySummary_pkey" PRIMARY KEY (id);


--
-- Name: Tenant Tenant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Tenant"
    ADD CONSTRAINT "Tenant_pkey" PRIMARY KEY (id);


--
-- Name: UserStoreRole UserStoreRole_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserStoreRole"
    ADD CONSTRAINT "UserStoreRole_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: BindToken_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "BindToken_tenantId_idx" ON public."BindToken" USING btree ("tenantId");


--
-- Name: BindToken_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "BindToken_token_idx" ON public."BindToken" USING btree (token);


--
-- Name: BindToken_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "BindToken_token_key" ON public."BindToken" USING btree (token);


--
-- Name: CustomerOrder_orderNo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CustomerOrder_orderNo_idx" ON public."CustomerOrder" USING btree ("orderNo");


--
-- Name: CustomerOrder_orderNo_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "CustomerOrder_orderNo_key" ON public."CustomerOrder" USING btree ("orderNo");


--
-- Name: CustomerOrder_storeId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CustomerOrder_storeId_createdAt_idx" ON public."CustomerOrder" USING btree ("storeId", "createdAt");


--
-- Name: CustomerOrder_tenantId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "CustomerOrder_tenantId_createdAt_idx" ON public."CustomerOrder" USING btree ("tenantId", "createdAt");


--
-- Name: MerchantPaymentConfig_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MerchantPaymentConfig_tenantId_idx" ON public."MerchantPaymentConfig" USING btree ("tenantId");


--
-- Name: MerchantPaymentConfig_tenantId_storeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "MerchantPaymentConfig_tenantId_storeId_idx" ON public."MerchantPaymentConfig" USING btree ("tenantId", "storeId");


--
-- Name: OperationLog_requestId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationLog_requestId_idx" ON public."OperationLog" USING btree ("requestId");


--
-- Name: OperationLog_storeId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationLog_storeId_createdAt_idx" ON public."OperationLog" USING btree ("storeId", "createdAt");


--
-- Name: OperationLog_tenantId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationLog_tenantId_createdAt_idx" ON public."OperationLog" USING btree ("tenantId", "createdAt");


--
-- Name: OperationLog_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "OperationLog_userId_createdAt_idx" ON public."OperationLog" USING btree ("userId", "createdAt");


--
-- Name: OpsAdmin_telegramId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "OpsAdmin_telegramId_key" ON public."OpsAdmin" USING btree ("telegramId");


--
-- Name: OpsAdmin_username_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "OpsAdmin_username_key" ON public."OpsAdmin" USING btree (username);


--
-- Name: PaymentIntent_merchantConfigId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PaymentIntent_merchantConfigId_idx" ON public."PaymentIntent" USING btree ("merchantConfigId");


--
-- Name: PaymentIntent_orderNo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PaymentIntent_orderNo_idx" ON public."PaymentIntent" USING btree ("orderNo");


--
-- Name: PaymentIntent_orderNo_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "PaymentIntent_orderNo_key" ON public."PaymentIntent" USING btree ("orderNo");


--
-- Name: PaymentIntent_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PaymentIntent_status_idx" ON public."PaymentIntent" USING btree (status);


--
-- Name: PaymentIntent_tenantId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "PaymentIntent_tenantId_createdAt_idx" ON public."PaymentIntent" USING btree ("tenantId", "createdAt");


--
-- Name: ProductCategory_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProductCategory_tenantId_idx" ON public."ProductCategory" USING btree ("tenantId");


--
-- Name: ProductCategory_tenantId_parentId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "ProductCategory_tenantId_parentId_idx" ON public."ProductCategory" USING btree ("tenantId", "parentId");


--
-- Name: Product_categoryId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Product_categoryId_idx" ON public."Product" USING btree ("categoryId");


--
-- Name: Product_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Product_name_idx" ON public."Product" USING btree (name);


--
-- Name: Product_tenantId_barcode_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Product_tenantId_barcode_key" ON public."Product" USING btree ("tenantId", barcode);


--
-- Name: Product_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Product_tenantId_idx" ON public."Product" USING btree ("tenantId");


--
-- Name: SaleRecord_barcode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SaleRecord_barcode_idx" ON public."SaleRecord" USING btree (barcode);


--
-- Name: SaleRecord_operatorUserId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SaleRecord_operatorUserId_createdAt_idx" ON public."SaleRecord" USING btree ("operatorUserId", "createdAt");


--
-- Name: SaleRecord_originalSaleRecordId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SaleRecord_originalSaleRecordId_idx" ON public."SaleRecord" USING btree ("originalSaleRecordId");


--
-- Name: SaleRecord_recordNo_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "SaleRecord_recordNo_key" ON public."SaleRecord" USING btree ("recordNo");


--
-- Name: SaleRecord_saleType_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SaleRecord_saleType_createdAt_idx" ON public."SaleRecord" USING btree ("saleType", "createdAt");


--
-- Name: SaleRecord_storeId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SaleRecord_storeId_createdAt_idx" ON public."SaleRecord" USING btree ("storeId", "createdAt");


--
-- Name: SaleRecord_tenantId_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SaleRecord_tenantId_createdAt_idx" ON public."SaleRecord" USING btree ("tenantId", "createdAt");


--
-- Name: StoreApplication_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "StoreApplication_status_idx" ON public."StoreApplication" USING btree (status);


--
-- Name: StoreApplication_telegramId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "StoreApplication_telegramId_idx" ON public."StoreApplication" USING btree ("telegramId");


--
-- Name: StoreCustomerContact_storeCode_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "StoreCustomerContact_storeCode_idx" ON public."StoreCustomerContact" USING btree ("storeCode");


--
-- Name: StoreCustomerContact_storeCode_telegramId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "StoreCustomerContact_storeCode_telegramId_key" ON public."StoreCustomerContact" USING btree ("storeCode", "telegramId");


--
-- Name: StoreCustomerContact_telegramId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "StoreCustomerContact_telegramId_idx" ON public."StoreCustomerContact" USING btree ("telegramId");


--
-- Name: StoreCustomerContact_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "StoreCustomerContact_tenantId_idx" ON public."StoreCustomerContact" USING btree ("tenantId");


--
-- Name: StoreDailySummary_storeId_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "StoreDailySummary_storeId_date_key" ON public."StoreDailySummary" USING btree ("storeId", date);


--
-- Name: StoreDailySummary_tenantId_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "StoreDailySummary_tenantId_date_idx" ON public."StoreDailySummary" USING btree ("tenantId", date);


--
-- Name: Store_code_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "Store_code_key" ON public."Store" USING btree (code);


--
-- Name: Store_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "Store_tenantId_idx" ON public."Store" USING btree ("tenantId");


--
-- Name: SupportSession_sessionState_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportSession_sessionState_idx" ON public."SupportSession" USING btree ("sessionState");


--
-- Name: SupportSession_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "SupportSession_tenantId_idx" ON public."SupportSession" USING btree ("tenantId");


--
-- Name: TelegramMessage_createdAt_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TelegramMessage_createdAt_idx" ON public."TelegramMessage" USING btree ("createdAt");


--
-- Name: TelegramMessage_recipientTelegramId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TelegramMessage_recipientTelegramId_idx" ON public."TelegramMessage" USING btree ("recipientTelegramId");


--
-- Name: TelegramMessage_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TelegramMessage_tenantId_idx" ON public."TelegramMessage" USING btree ("tenantId");


--
-- Name: TenantDailySummary_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "TenantDailySummary_date_idx" ON public."TenantDailySummary" USING btree (date);


--
-- Name: TenantDailySummary_tenantId_date_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "TenantDailySummary_tenantId_date_key" ON public."TenantDailySummary" USING btree ("tenantId", date);


--
-- Name: UserStoreRole_storeId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UserStoreRole_storeId_idx" ON public."UserStoreRole" USING btree ("storeId");


--
-- Name: UserStoreRole_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "UserStoreRole_tenantId_idx" ON public."UserStoreRole" USING btree ("tenantId");


--
-- Name: UserStoreRole_userId_storeId_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "UserStoreRole_userId_storeId_key" ON public."UserStoreRole" USING btree ("userId", "storeId");


--
-- Name: User_tenantId_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX "User_tenantId_idx" ON public."User" USING btree ("tenantId");


--
-- Name: User_tenantId_username_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX "User_tenantId_username_key" ON public."User" USING btree ("tenantId", username);


--
-- Name: BindToken BindToken_storeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BindToken"
    ADD CONSTRAINT "BindToken_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES public."Store"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: BindToken BindToken_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."BindToken"
    ADD CONSTRAINT "BindToken_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OperationLog OperationLog_saleRecordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationLog"
    ADD CONSTRAINT "OperationLog_saleRecordId_fkey" FOREIGN KEY ("saleRecordId") REFERENCES public."SaleRecord"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OperationLog OperationLog_storeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationLog"
    ADD CONSTRAINT "OperationLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES public."Store"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: OperationLog OperationLog_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationLog"
    ADD CONSTRAINT "OperationLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: OperationLog OperationLog_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."OperationLog"
    ADD CONSTRAINT "OperationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PaymentIntent PaymentIntent_merchantConfigId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."PaymentIntent"
    ADD CONSTRAINT "PaymentIntent_merchantConfigId_fkey" FOREIGN KEY ("merchantConfigId") REFERENCES public."MerchantPaymentConfig"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ProductCategory ProductCategory_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."ProductCategory"
    ADD CONSTRAINT "ProductCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."ProductCategory"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Product Product_categoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES public."ProductCategory"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Product Product_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Product"
    ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SaleRecord SaleRecord_operatorUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SaleRecord"
    ADD CONSTRAINT "SaleRecord_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SaleRecord SaleRecord_originalSaleRecordId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SaleRecord"
    ADD CONSTRAINT "SaleRecord_originalSaleRecordId_fkey" FOREIGN KEY ("originalSaleRecordId") REFERENCES public."SaleRecord"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SaleRecord SaleRecord_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SaleRecord"
    ADD CONSTRAINT "SaleRecord_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."Product"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SaleRecord SaleRecord_storeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SaleRecord"
    ADD CONSTRAINT "SaleRecord_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES public."Store"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SaleRecord SaleRecord_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."SaleRecord"
    ADD CONSTRAINT "SaleRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Store Store_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."Store"
    ADD CONSTRAINT "Store_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: UserStoreRole UserStoreRole_storeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserStoreRole"
    ADD CONSTRAINT "UserStoreRole_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES public."Store"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: UserStoreRole UserStoreRole_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."UserStoreRole"
    ADD CONSTRAINT "UserStoreRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: User User_tenantId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--

\unrestrict hXvLsbnSzaln3WEzfK8mCE9pNfbBq0PpuK4ZStsdTHvz0sgt5BJUNlwanK1urFG

