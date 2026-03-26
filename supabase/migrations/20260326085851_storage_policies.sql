-- ============================================================
-- Migration: storage_policies
-- Description: Storage bucket and RLS policies for resume uploads
-- ============================================================

-- Create the resumes bucket (private, 10 MB limit, PDF + DOCX only)
-- NOTE: Bucket creation must be done via Supabase Dashboard or
-- programmatically via the storage API. This migration handles
-- only the RLS policies. Create the bucket manually:
--   Name: resumes
--   Public: No
--   File size limit: 10485760 (10 MB)
--   Allowed MIME types: application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document

-- Users can upload to their own folder: resumes/{user_id}/*
CREATE POLICY "Users can upload own resumes"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'resumes'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can read their own resumes
CREATE POLICY "Users can read own resumes"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'resumes'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can update (replace) their own resumes
CREATE POLICY "Users can update own resumes"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'resumes'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can delete their own resumes
CREATE POLICY "Users can delete own resumes"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'resumes'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
