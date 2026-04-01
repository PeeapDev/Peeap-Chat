import { NextRequest, NextResponse } from "next/server";
import { authenticateAny, type AuthResult } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { handleCORS, corsHeaders } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

function getUserId(auth: AuthResult): string | null {
  if (auth.type === "user") return auth.userId;
  if (auth.type === "platform") return auth.platformOwnerId;
  return null;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// POST /api/media/upload - Upload encrypted media file
// Client encrypts file before upload; server stores ciphertext in Supabase Storage
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const auth = await authenticateAny(request);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers }
      );
    }

    const userId = getUserId(auth);
    if (!userId) {
      return NextResponse.json(
        { error: "User authentication required" },
        { status: 403, headers }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const conversationId = formData.get("conversation_id") as string;
    const fileName = formData.get("file_name") as string || file?.name || "upload";
    const fileType = formData.get("file_type") as string || "file";
    const mimeType = formData.get("mime_type") as string || file?.type || "application/octet-stream";
    const isEncrypted = formData.get("is_encrypted") === "true";
    const width = formData.get("width") ? parseInt(formData.get("width") as string) : undefined;
    const height = formData.get("height") ? parseInt(formData.get("height") as string) : undefined;
    const durationSeconds = formData.get("duration_seconds") ? parseFloat(formData.get("duration_seconds") as string) : undefined;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400, headers }
      );
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: "conversation_id is required" },
        { status: 400, headers }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 50MB." },
        { status: 413, headers }
      );
    }

    // Verify user is a member of the conversation
    const { data: membership } = await supabase
      .from("conversation_members")
      .select("role")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .single();

    if (!membership) {
      return NextResponse.json(
        { error: "Not a member of this conversation" },
        { status: 403, headers }
      );
    }

    // Generate storage path
    const timestamp = Date.now();
    const ext = fileName.split(".").pop() || "bin";
    const storagePath = `${conversationId}/${userId}/${timestamp}.${ext}`;

    // Upload to Supabase Storage
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await supabase.storage
      .from("chat-media")
      .upload(storagePath, fileBuffer, {
        contentType: isEncrypted ? "application/octet-stream" : mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload file" },
        { status: 500, headers }
      );
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from("chat-media")
      .getPublicUrl(storagePath);

    // Create media_files record
    const { data: mediaRecord, error: dbError } = await supabase
      .from("media_files")
      .insert({
        uploader_id: userId,
        file_name: fileName,
        file_type: fileType,
        file_size: file.size,
        mime_type: mimeType,
        storage_path: storagePath,
        width,
        height,
        duration_seconds: durationSeconds,
      })
      .select()
      .single();

    if (dbError) {
      console.error("Media record error:", dbError);
      // File uploaded but record failed - still return success with path
    }

    return NextResponse.json(
      {
        media_id: mediaRecord?.id,
        storage_path: storagePath,
        public_url: urlData?.publicUrl,
        file_size: file.size,
        is_encrypted: isEncrypted,
      },
      { status: 201, headers }
    );
  } catch (err) {
    console.error("Media upload error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
