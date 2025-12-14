-- Migration: Add product price and cost fields to campaigns table
-- Description: Allows campaigns to specify product pricing for accurate ROA calculation

-- Add product_price column (selling price per unit)
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS product_price NUMERIC(10, 2);

-- Add product_cost column (production cost per unit, optional)
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS product_cost NUMERIC(10, 2);

-- Add comments
COMMENT ON COLUMN campaigns.product_price IS 'Selling price per product unit. Used to calculate revenue = conversions × product_price';
COMMENT ON COLUMN campaigns.product_cost IS 'Production cost per product unit (optional). Used to calculate profit and accurate ROA = (revenue - costs) / ad_spend';

