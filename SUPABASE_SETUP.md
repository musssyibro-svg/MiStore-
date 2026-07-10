# Supabase Setup for Bike Image Manager

## SQL Migrations

Run these queries in your Supabase SQL Editor (https://app.supabase.com → SQL Editor):

### 1. Extend product_images table for bike images

```sql
-- Add bike-specific columns if they don't exist
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;
ALTER TABLE product_images ADD COLUMN IF NOT EXISTS created_by UUID;

-- Create index for faster bike image queries
CREATE INDEX IF NOT EXISTS idx_product_images_model_order 
ON product_images(model, display_order) 
WHERE condition = 'bike';
```

### 2. Storage Bucket Setup

Run in SQL Editor to create the `bike-photos` bucket:

```sql
-- Create bike-photos bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('bike-photos', 'bike-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Allow public reads (for bikes.html)
CREATE POLICY "Public can read bike photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'bike-photos');

-- Allow authenticated uploads
CREATE POLICY "Authenticated can upload bike photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'bike-photos'
    and auth.role() = 'authenticated'
  );

-- Allow authenticated delete
CREATE POLICY "Authenticated can delete bike photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'bike-photos'
    and auth.role() = 'authenticated'
  );
```

## Data Structure

Bike images are stored in `product_images` table with:
- `model`: Bike model name (e.g., "V8", "M5")
- `image_path`: Storage path in `bike-photos` bucket
- `display_order`: Display order (0 = first image)
- `created_at`: Upload timestamp
- `created_by`: User ID who uploaded
- `condition`: Set to 'bike' for bike images

## Upload Workflow

1. Admin clicks "Bikes" tab in admin.html
2. Selects bike model from grid
3. Drags images or clicks to upload
4. Images stored in `bike-photos` bucket
5. Metadata saved to `product_images` table
6. bikes.html fetches and displays images from Supabase

## Public Access

- **bikes.html**: Fetches images anonymously (public read access)
- **admin.html**: Upload/delete requires authentication
- All images private by default (signed URLs required for public access)

## Testing

```javascript
// Test in browser console:
const { data, error } = await db.from('product_images')
  .select('*')
  .eq('condition', 'bike')
  .order('model', { ascending: true });
console.log(data);
```
