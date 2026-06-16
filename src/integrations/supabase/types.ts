export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_settings: {
        Row: {
          auto_reply: boolean
          blacklist_numbers: string[]
          business_hours_only: boolean
          business_tone: string
          closing_script: string
          created_at: string
          daily_message_limit: number
          enabled: boolean
          faq_answers: string
          followup_script: string
          followup_test_mode: boolean
          human_keywords: string[]
          id: string
          language: string
          max_reply_delay_seconds: number
          min_reply_delay_seconds: number
          model: string
          objection_handling: string
          personality: string
          pricing_rules: string
          sales_script: string
          spam_protection: boolean
          stop_after_appointment: boolean
          stop_on_human_reply: boolean
          stop_on_human_request: boolean
          system_prompt: string
          temperature: number
          tone: string
          updated_at: string
          whitelist_numbers: string[]
          workspace_id: string
        }
        Insert: {
          auto_reply?: boolean
          blacklist_numbers?: string[]
          business_hours_only?: boolean
          business_tone?: string
          closing_script?: string
          created_at?: string
          daily_message_limit?: number
          enabled?: boolean
          faq_answers?: string
          followup_script?: string
          followup_test_mode?: boolean
          human_keywords?: string[]
          id?: string
          language?: string
          max_reply_delay_seconds?: number
          min_reply_delay_seconds?: number
          model?: string
          objection_handling?: string
          personality?: string
          pricing_rules?: string
          sales_script?: string
          spam_protection?: boolean
          stop_after_appointment?: boolean
          stop_on_human_reply?: boolean
          stop_on_human_request?: boolean
          system_prompt?: string
          temperature?: number
          tone?: string
          updated_at?: string
          whitelist_numbers?: string[]
          workspace_id: string
        }
        Update: {
          auto_reply?: boolean
          blacklist_numbers?: string[]
          business_hours_only?: boolean
          business_tone?: string
          closing_script?: string
          created_at?: string
          daily_message_limit?: number
          enabled?: boolean
          faq_answers?: string
          followup_script?: string
          followup_test_mode?: boolean
          human_keywords?: string[]
          id?: string
          language?: string
          max_reply_delay_seconds?: number
          min_reply_delay_seconds?: number
          model?: string
          objection_handling?: string
          personality?: string
          pricing_rules?: string
          sales_script?: string
          spam_protection?: boolean
          stop_after_appointment?: boolean
          stop_on_human_reply?: boolean
          stop_on_human_request?: boolean
          system_prompt?: string
          temperature?: number
          tone?: string
          updated_at?: string
          whitelist_numbers?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          appointment_date: string | null
          appointment_datetime: string | null
          appointment_time: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          ends_at: string | null
          id: string
          name: string | null
          notes: string | null
          phone: string | null
          reminder_15m_sent: boolean
          reminder_1h_sent: boolean
          reminder_24h_sent: boolean
          service_needed: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["appointment_status"]
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          appointment_date?: string | null
          appointment_datetime?: string | null
          appointment_time?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          phone?: string | null
          reminder_15m_sent?: boolean
          reminder_1h_sent?: boolean
          reminder_24h_sent?: boolean
          service_needed?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["appointment_status"]
          title?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          appointment_date?: string | null
          appointment_datetime?: string | null
          appointment_time?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          phone?: string | null
          reminder_15m_sent?: boolean
          reminder_1h_sent?: boolean
          reminder_24h_sent?: boolean
          service_needed?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["appointment_status"]
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      bot_logs: {
        Row: {
          bot_name: string
          channel: Database["public"]["Enums"]["channel_type"] | null
          created_at: string
          id: string
          level: string
          message: string
          metadata: Json
          workspace_id: string
        }
        Insert: {
          bot_name: string
          channel?: Database["public"]["Enums"]["channel_type"] | null
          created_at?: string
          id?: string
          level?: string
          message: string
          metadata?: Json
          workspace_id: string
        }
        Update: {
          bot_name?: string
          channel?: Database["public"]["Enums"]["channel_type"] | null
          created_at?: string
          id?: string
          level?: string
          message?: string
          metadata?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_knowledge: {
        Row: {
          category: string | null
          content: string
          created_at: string
          id: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category?: string | null
          content: string
          created_at?: string
          id?: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          category?: string | null
          content?: string
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_knowledge_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          config: Json
          created_at: string
          id: string
          name: string
          status: Database["public"]["Enums"]["channel_status"]
          type: Database["public"]["Enums"]["channel_type"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          name: string
          status?: Database["public"]["Enums"]["channel_status"]
          type: Database["public"]["Enums"]["channel_type"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["channel_status"]
          type?: Database["public"]["Enums"]["channel_type"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          ai_enabled: boolean
          channel: Database["public"]["Enums"]["channel_type"] | null
          created_at: string
          email: string | null
          external_id: string | null
          human_takeover: boolean
          id: string
          is_blacklisted: boolean
          is_whitelisted: boolean
          name: string | null
          phone: string | null
          remote_jid: string | null
          sender_number: string | null
          tags: string[]
          updated_at: string
          whatsapp_number: string | null
          workspace_id: string
        }
        Insert: {
          ai_enabled?: boolean
          channel?: Database["public"]["Enums"]["channel_type"] | null
          created_at?: string
          email?: string | null
          external_id?: string | null
          human_takeover?: boolean
          id?: string
          is_blacklisted?: boolean
          is_whitelisted?: boolean
          name?: string | null
          phone?: string | null
          remote_jid?: string | null
          sender_number?: string | null
          tags?: string[]
          updated_at?: string
          whatsapp_number?: string | null
          workspace_id: string
        }
        Update: {
          ai_enabled?: boolean
          channel?: Database["public"]["Enums"]["channel_type"] | null
          created_at?: string
          email?: string | null
          external_id?: string | null
          human_takeover?: boolean
          id?: string
          is_blacklisted?: boolean
          is_whitelisted?: boolean
          name?: string | null
          phone?: string | null
          remote_jid?: string | null
          sender_number?: string | null
          tags?: string[]
          updated_at?: string
          whatsapp_number?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          assigned_to: string | null
          channel_id: string | null
          contact_id: string | null
          created_at: string
          id: string
          last_message_at: string | null
          remote_jid: string | null
          sender_number: string | null
          status: Database["public"]["Enums"]["conversation_status"]
          unread_count: number
          updated_at: string
          whatsapp_number: string | null
          workspace_id: string
        }
        Insert: {
          assigned_to?: string | null
          channel_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          remote_jid?: string | null
          sender_number?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
          whatsapp_number?: string | null
          workspace_id: string
        }
        Update: {
          assigned_to?: string | null
          channel_id?: string | null
          contact_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          remote_jid?: string | null
          sender_number?: string | null
          status?: Database["public"]["Enums"]["conversation_status"]
          unread_count?: number
          updated_at?: string
          whatsapp_number?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      instagram_accounts: {
        Row: {
          access_token: string | null
          channel_id: string | null
          created_at: string
          id: string
          ig_user_id: string | null
          updated_at: string
          username: string | null
          webhook_verified: boolean
          workspace_id: string
        }
        Insert: {
          access_token?: string | null
          channel_id?: string | null
          created_at?: string
          id?: string
          ig_user_id?: string | null
          updated_at?: string
          username?: string | null
          webhook_verified?: boolean
          workspace_id: string
        }
        Update: {
          access_token?: string | null
          channel_id?: string | null
          created_at?: string
          id?: string
          ig_user_id?: string | null
          updated_at?: string
          username?: string | null
          webhook_verified?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "instagram_accounts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "instagram_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_followups: {
        Row: {
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          error: string | null
          followup_type: string
          id: string
          message: string
          phone: string
          scheduled_at: string
          sent_at: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          followup_type: string
          id?: string
          message: string
          phone: string
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          error?: string | null
          followup_type?: string
          id?: string
          message?: string
          phone?: string
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_followups_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_followups_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          ai_summary: string | null
          appointment_date: string | null
          assigned_to: string | null
          budget: string | null
          business_name: string | null
          contact_id: string | null
          created_at: string
          deal_value: number | null
          email: string | null
          follow_up_date: string | null
          id: string
          last_message: string | null
          lead_score: number
          name: string | null
          notes: string | null
          phone: string | null
          service_interest: string | null
          source: string | null
          stage: Database["public"]["Enums"]["lead_stage"]
          stage_changed_at: string
          status: string
          updated_at: string
          value: number
          won_date: string | null
          workspace_id: string
        }
        Insert: {
          ai_summary?: string | null
          appointment_date?: string | null
          assigned_to?: string | null
          budget?: string | null
          business_name?: string | null
          contact_id?: string | null
          created_at?: string
          deal_value?: number | null
          email?: string | null
          follow_up_date?: string | null
          id?: string
          last_message?: string | null
          lead_score?: number
          name?: string | null
          notes?: string | null
          phone?: string | null
          service_interest?: string | null
          source?: string | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          stage_changed_at?: string
          status?: string
          updated_at?: string
          value?: number
          won_date?: string | null
          workspace_id: string
        }
        Update: {
          ai_summary?: string | null
          appointment_date?: string | null
          assigned_to?: string | null
          budget?: string | null
          business_name?: string | null
          contact_id?: string | null
          created_at?: string
          deal_value?: number | null
          email?: string | null
          follow_up_date?: string | null
          id?: string
          last_message?: string | null
          lead_score?: number
          name?: string | null
          notes?: string | null
          phone?: string | null
          service_interest?: string | null
          source?: string | null
          stage?: Database["public"]["Enums"]["lead_stage"]
          stage_changed_at?: string
          status?: string
          updated_at?: string
          value?: number
          won_date?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: Json
          body: string | null
          conversation_id: string
          created_at: string
          delivered_at: string | null
          delivery_error: string | null
          delivery_status:
            | Database["public"]["Enums"]["message_delivery_status"]
            | null
          direction: Database["public"]["Enums"]["message_direction"]
          id: string
          provider_message_id: string | null
          sender: Database["public"]["Enums"]["message_sender"]
          target_jid: string | null
          workspace_id: string
        }
        Insert: {
          attachments?: Json
          body?: string | null
          conversation_id: string
          created_at?: string
          delivered_at?: string | null
          delivery_error?: string | null
          delivery_status?:
            | Database["public"]["Enums"]["message_delivery_status"]
            | null
          direction: Database["public"]["Enums"]["message_direction"]
          id?: string
          provider_message_id?: string | null
          sender: Database["public"]["Enums"]["message_sender"]
          target_jid?: string | null
          workspace_id: string
        }
        Update: {
          attachments?: Json
          body?: string | null
          conversation_id?: string
          created_at?: string
          delivered_at?: string | null
          delivery_error?: string | null
          delivery_status?:
            | Database["public"]["Enums"]["message_delivery_status"]
            | null
          direction?: Database["public"]["Enums"]["message_direction"]
          id?: string
          provider_message_id?: string | null
          sender?: Database["public"]["Enums"]["message_sender"]
          target_jid?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_pages: {
        Row: {
          access_token: string | null
          channel_id: string | null
          created_at: string
          id: string
          page_id: string | null
          page_name: string | null
          updated_at: string
          webhook_verified: boolean
          workspace_id: string
        }
        Insert: {
          access_token?: string | null
          channel_id?: string | null
          created_at?: string
          id?: string
          page_id?: string | null
          page_name?: string | null
          updated_at?: string
          webhook_verified?: boolean
          workspace_id: string
        }
        Update: {
          access_token?: string | null
          channel_id?: string | null
          created_at?: string
          id?: string
          page_id?: string | null
          page_name?: string | null
          updated_at?: string
          webhook_verified?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_pages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_pages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reply_rules: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          name: string
          priority: number
          response: string
          trigger_keywords: string[]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          name: string
          priority?: number
          response: string
          trigger_keywords?: string[]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          priority?: number
          response?: string
          trigger_keywords?: string[]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reply_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_logs: {
        Row: {
          category: string
          conversation_id: string | null
          created_at: string
          description: string | null
          id: string
          resolved: boolean
          severity: Database["public"]["Enums"]["risk_severity"]
          workspace_id: string
        }
        Insert: {
          category: string
          conversation_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          resolved?: boolean
          severity?: Database["public"]["Enums"]["risk_severity"]
          workspace_id: string
        }
        Update: {
          category?: string
          conversation_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          resolved?: boolean
          severity?: Database["public"]["Enums"]["risk_severity"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_sessions: {
        Row: {
          ai_enabled: boolean
          channel_id: string | null
          counter_date: string
          created_at: string
          daily_limit: number
          device_name: string | null
          facebook_lead_only: boolean
          id: string
          last_seen_at: string | null
          list_mode: string
          max_delay_seconds: number
          messages_today: number
          min_delay_seconds: number
          phone_number: string | null
          qr_code: string | null
          status: Database["public"]["Enums"]["channel_status"]
          updated_at: string
          vps_api_token: string | null
          vps_endpoint: string | null
          webhook_secret: string
          workspace_id: string
        }
        Insert: {
          ai_enabled?: boolean
          channel_id?: string | null
          counter_date?: string
          created_at?: string
          daily_limit?: number
          device_name?: string | null
          facebook_lead_only?: boolean
          id?: string
          last_seen_at?: string | null
          list_mode?: string
          max_delay_seconds?: number
          messages_today?: number
          min_delay_seconds?: number
          phone_number?: string | null
          qr_code?: string | null
          status?: Database["public"]["Enums"]["channel_status"]
          updated_at?: string
          vps_api_token?: string | null
          vps_endpoint?: string | null
          webhook_secret?: string
          workspace_id: string
        }
        Update: {
          ai_enabled?: boolean
          channel_id?: string | null
          counter_date?: string
          created_at?: string
          daily_limit?: number
          device_name?: string | null
          facebook_lead_only?: boolean
          id?: string
          last_seen_at?: string | null
          list_mode?: string
          max_delay_seconds?: number
          messages_today?: number
          min_delay_seconds?: number
          phone_number?: string | null
          qr_code?: string | null
          status?: Database["public"]["Enums"]["channel_status"]
          updated_at?: string
          vps_api_token?: string | null
          vps_endpoint?: string | null
          webhook_secret?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_sessions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_sessions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      owns_workspace: { Args: { _workspace_id: string }; Returns: boolean }
    }
    Enums: {
      appointment_status:
        | "scheduled"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
      channel_status: "disconnected" | "connecting" | "connected" | "error"
      channel_type: "whatsapp" | "messenger" | "instagram"
      conversation_status: "open" | "snoozed" | "closed" | "human"
      lead_stage:
        | "new"
        | "contacted"
        | "qualified"
        | "proposal"
        | "won"
        | "lost"
        | "interested"
        | "appointment_booked"
        | "negotiation"
      message_delivery_status: "pending" | "sent" | "delivered" | "failed"
      message_direction: "inbound" | "outbound"
      message_sender: "contact" | "ai" | "human" | "system"
      risk_severity: "low" | "medium" | "high" | "critical"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      appointment_status: [
        "scheduled",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
      channel_status: ["disconnected", "connecting", "connected", "error"],
      channel_type: ["whatsapp", "messenger", "instagram"],
      conversation_status: ["open", "snoozed", "closed", "human"],
      lead_stage: [
        "new",
        "contacted",
        "qualified",
        "proposal",
        "won",
        "lost",
        "interested",
        "appointment_booked",
        "negotiation",
      ],
      message_delivery_status: ["pending", "sent", "delivered", "failed"],
      message_direction: ["inbound", "outbound"],
      message_sender: ["contact", "ai", "human", "system"],
      risk_severity: ["low", "medium", "high", "critical"],
    },
  },
} as const
