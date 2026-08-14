// ============================================================================
// Database types — mirrors the schema in supabase/migrations/0001_schema.sql.
// After any schema change, regenerate with:
//   npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
// (This hand-maintained copy matches the initial migrations exactly.)
// ============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "superadmin" | "manager" | "pic" | "driver";
export type CycleStatus =
  | "OPEN"
  | "ORDERED"
  | "PURCHASED"
  | "IN_DELIVERY"
  | "COMPLETED";
export type RequestStatus = "DRAFT" | "SUBMITTED";
export type DeliveryStatus = "PENDING" | "LOADED" | "RECEIVED";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          username: string | null;
          role: UserRole;
          store_id: string | null;
          phone: string | null;
          is_active: boolean;
          last_login_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username?: string | null;
          role?: UserRole;
          store_id?: string | null;
          phone?: string | null;
          is_active?: boolean;
          last_login_at?: string | null;
        };
        Update: {
          username?: string | null;
          role?: UserRole;
          store_id?: string | null;
          phone?: string | null;
          is_active?: boolean;
          last_login_at?: string | null;
        };
        Relationships: [];
      };
      stores: {
        Row: {
          id: string;
          name: string;
          address: string | null;
          pic_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          address?: string | null;
          pic_id?: string | null;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          address?: string | null;
          pic_id?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
      items: {
        Row: {
          id: string;
          name: string;
          default_unit: string;
          emoji: string | null;
          is_active: boolean;
          is_approved: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          default_unit?: string;
          emoji?: string | null;
          is_active?: boolean;
          is_approved?: boolean;
          created_by?: string | null;
        };
        Update: {
          name?: string;
          default_unit?: string;
          emoji?: string | null;
          is_active?: boolean;
          is_approved?: boolean;
        };
        Relationships: [];
      };
      vendors: {
        Row: {
          id: string;
          name: string;
          whatsapp_number: string;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          whatsapp_number: string;
          notes?: string | null;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          whatsapp_number?: string;
          notes?: string | null;
          is_active?: boolean;
        };
        Relationships: [];
      };
      order_cycles: {
        Row: {
          id: string;
          cycle_date: string;
          status: CycleStatus;
          created_by: string | null;
          locked_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          cycle_date?: string;
          status?: CycleStatus;
          created_by?: string | null;
        };
        Update: {
          status?: CycleStatus;
        };
        Relationships: [];
      };
      store_requests: {
        Row: {
          id: string;
          cycle_id: string;
          store_id: string;
          status: RequestStatus;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          cycle_id: string;
          store_id: string;
          status?: RequestStatus;
          created_by?: string | null;
        };
        Update: {
          status?: RequestStatus;
        };
        Relationships: [];
      };
      request_items: {
        Row: {
          id: string;
          store_request_id: string;
          item_id: string;
          requested_qty: number;
          unit: string;
          purchased_qty: number | null;
          unit_cost: number | null;
          selling_price: number | null;
          line_total: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_request_id: string;
          item_id: string;
          requested_qty: number;
          unit: string;
        };
        Update: {
          item_id?: string;
          requested_qty?: number;
          unit?: string;
          purchased_qty?: number | null;
          unit_cost?: number | null;
          selling_price?: number | null;
        };
        Relationships: [];
      };
      vendor_orders: {
        Row: {
          id: string;
          cycle_id: string;
          vendor_id: string;
          message_snapshot: string;
          sent_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          cycle_id: string;
          vendor_id: string;
          message_snapshot: string;
          sent_at?: string | null;
        };
        Update: {
          sent_at?: string | null;
        };
        Relationships: [];
      };
      vendor_order_items: {
        Row: {
          id: string;
          vendor_order_id: string;
          item_id: string;
          total_qty: number;
          unit: string;
        };
        Insert: {
          id?: string;
          vendor_order_id: string;
          item_id: string;
          total_qty: number;
          unit: string;
        };
        Update: {
          total_qty?: number;
          unit?: string;
        };
        Relationships: [];
      };
      deliveries: {
        Row: {
          id: string;
          cycle_id: string;
          store_id: string;
          driver_id: string | null;
          status: DeliveryStatus;
          photo_path: string | null;
          loaded_at: string | null;
          received_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          cycle_id: string;
          store_id: string;
        };
        Update: {
          status?: DeliveryStatus;
          photo_path?: string | null;
        };
        Relationships: [];
      };
      delivery_item_checks: {
        Row: {
          id: string;
          delivery_id: string;
          request_item_id: string;
          checked: boolean;
          updated_at: string;
        };
        Insert: {
          id?: string;
          delivery_id: string;
          request_item_id: string;
          checked?: boolean;
        };
        Update: {
          checked?: boolean;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: number;
          actor_id: string | null;
          action: string;
          table_name: string;
          record_id: string;
          old_data: Json | null;
          new_data: Json | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      login_attempts: {
        Row: {
          id: number;
          email: string;
          ip: string | null;
          success: boolean;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: {
      driver_delivery_items: {
        Row: {
          check_id: string;
          delivery_id: string;
          checked: boolean;
          request_item_id: string;
          item_name: string;
          item_emoji: string | null;
          qty: number;
          unit: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      get_my_role: {
        Args: Record<string, never>;
        Returns: UserRole | null;
      };
      get_my_store_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      is_active_user: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: {
      user_role: UserRole;
      cycle_status: CycleStatus;
      request_status: RequestStatus;
      delivery_status: DeliveryStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];
export type Views<T extends keyof Database["public"]["Views"]> =
  Database["public"]["Views"][T]["Row"];
