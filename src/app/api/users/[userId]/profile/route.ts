import { NextRequest, NextResponse } from "next/server";
import { authenticateAny } from "@/lib/auth";
import { mainSupabase, supabase } from "@/lib/supabase";
import { handleCORS, corsHeaders } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

/**
 * GET /api/users/:userId/profile
 * Returns full Peeap user profile + merchant/shop data if applicable
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);
  const { userId } = params;

  try {
    const auth = await authenticateAny(request);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers }
      );
    }

    // Guests (embeddable public chat) may not enumerate user profiles.
    if (auth.type === "user" && auth.payload.roles.includes("guest")) {
      return NextResponse.json(
        { error: "Forbidden" },
        { status: 403, headers }
      );
    }

    const requesterId = auth.type === "user" ? auth.userId : null;

    // Fetch user profile from main Supabase — explicit column list only, never
    // select("*") (avoids leaking any future sensitive column into the bundle).
    const { data: user, error: userError } = await mainSupabase
      .from("users")
      .select(
        "id, first_name, last_name, username, email, phone, profile_picture, avatar_url, bio, account_type, roles, created_at"
      )
      .eq("id", userId)
      .single();

    if (userError || !user) {
      console.error("Profile lookup failed:", userError?.message, "userId:", userId);
      return NextResponse.json(
        { error: "User not found" },
        { status: 404, headers }
      );
    }

    // Contact PII (email/phone) is only exposed to the user themselves or to
    // someone who shares a conversation / contact relationship with them.
    let canSeeContact = requesterId === userId;
    if (!canSeeContact && requesterId) {
      const [{ data: contact }, { data: sharedConvos }] = await Promise.all([
        supabase
          .from("contacts")
          .select("id")
          .eq("user_id", requesterId)
          .eq("contact_user_id", userId)
          .maybeSingle(),
        supabase
          .from("conversation_members")
          .select("conversation_id")
          .eq("user_id", requesterId),
      ]);
      if (contact) {
        canSeeContact = true;
      } else if (sharedConvos && sharedConvos.length > 0) {
        const convoIds = sharedConvos.map((c) => c.conversation_id);
        const { data: targetMembership } = await supabase
          .from("conversation_members")
          .select("conversation_id")
          .eq("user_id", userId)
          .in("conversation_id", convoIds)
          .limit(1);
        canSeeContact = !!(targetMembership && targetMembership.length > 0);
      }
    }

    const profile: Record<string, unknown> = {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      display_name:
        [user.first_name, user.last_name].filter(Boolean).join(" ") ||
        user.username ||
        "Unknown",
      username: user.username || null,
      email: canSeeContact ? user.email : null,
      phone: canSeeContact ? user.phone : null,
      avatar_url: user.profile_picture || user.avatar_url || null,
      bio: user.bio || null,
      account_type: user.account_type || "personal",
      roles: Array.isArray(user.roles) ? user.roles : [],
      joined_at: user.created_at,
    };

    // If user is a merchant, fetch their merchant/shop data
    const roles = Array.isArray(user.roles) ? user.roles : [];
    const isMerchant =
      user.account_type === "merchant" ||
      roles.includes("merchant");

    if (isMerchant) {
      // Fetch merchant info from merchant_businesses table
      const { data: merchantRows, error: merchantErr } = await mainSupabase
        .from("merchant_businesses")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1);

      const merchant = merchantRows?.[0] || null;

      console.log("[Profile] Merchant lookup for", userId, "→", merchant ? "found" : "not found", merchantErr?.message || "");

      if (merchant) {
        profile.merchant = {
          id: merchant.id,
          business_name: merchant.name || merchant.business_name || "Business",
          category: merchant.category || "General",
          logo: merchant.logo || null,
          description: merchant.description || null,
          slug: merchant.slug || null,
          is_verified: merchant.is_verified || false,
          store_url: merchant.slug
            ? `https://store.peeap.com/${merchant.slug}`
            : null,
        };

        // Fetch top products (up to 6)
        try {
          const { data: products } = await mainSupabase
            .from("products")
            .select("*")
            .eq("merchant_id", merchant.id)
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .limit(6);

          profile.products = (products || []).map((p: any) => ({
            id: p.id,
            name: p.name || p.title || "Product",
            price: p.price || 0,
            currency: p.currency || "SLE",
            image_url: p.image_url || p.image || null,
            slug: p.slug || null,
            url: merchant.slug && p.slug
              ? `https://store.peeap.com/${merchant.slug}/${p.slug}`
              : null,
          }));
        } catch {
          profile.products = [];
        }
      }
    }

    return NextResponse.json({ profile }, { status: 200, headers });
  } catch (err: unknown) {
    console.error("User profile error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
