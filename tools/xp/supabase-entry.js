// Reemplaza al <script src=".../supabase-js@2/dist/umd/supabase.js"> de index.html.
import { createClient } from '@supabase/supabase-js';
window.supabase = { createClient: createClient };
