import { defineAction } from "astro:actions";
import { z } from "astro:schema";
import { parseSetCookie } from "../scripts/utils";

const serverAddress = import.meta.env.SERVER_ADDRESS;

export const server = {
  login: defineAction({
    accept: "form",
    input: z.object({
      username: z.string().min(2, "Username must be at least 2 characters long"),
      password: z.string().min(4, "Password must be at least 4 characters long"),
    }),
    handler: async (input, event) => {
      const { username, password } = input;
      const url = `${serverAddress || "http://localhost:8080"}/login`;

      const backendResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username, password }),
      });

      const data = await backendResponse.json();

      if (!backendResponse.ok) {
        return {
          success: false,
          message: data.error || "Failed to login",
          status: backendResponse.status,
          data,
        };
      }

      const setCookieHeader = backendResponse.headers.get("set-cookie");
      if (setCookieHeader) {
        const parsed = parseSetCookie(setCookieHeader);
        if (parsed) {
          event.cookies.set(parsed.name, parsed.value, {
            path: parsed.path,
            httpOnly: parsed.httpOnly,
            secure: parsed.secure,
            expires: parsed.expires,
            sameSite: parsed.sameSite,
          });
        }
      }

      return {
        success: true,
        message: data.message || "Login successful",
        status: backendResponse.status,
        userID: data.userID || -1,
        data,
      };
    },
  }),

  register: defineAction({
    accept: "form",
    input: z.object({
      username: z.string().min(2, "Username must be at least 2 characters long"),
      password: z.string().min(4, "Password must be at least 4 characters long"),
    }),
    handler: async (input, event) => {
      const { username, password } = input;
      const url = `${serverAddress || "http://localhost:8080"}/register`;

      const backendResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username, password }),
      });

      const data = await backendResponse.json();

      if (!backendResponse.ok) {
        return {
          success: false,
          message: data.error || "Failed to register",
          status: backendResponse.status,
          data,
        };
      }

      const setCookieHeader = backendResponse.headers.get("set-cookie");
      if (setCookieHeader) {
        const parsed = parseSetCookie(setCookieHeader);
        if (parsed) {
          event.cookies.set(parsed.name, parsed.value, {
            path: parsed.path,
            httpOnly: parsed.httpOnly,
            secure: parsed.secure,
            expires: parsed.expires,
            sameSite: parsed.sameSite,
          });
        }
      }

      return {
        success: true,
        message: data.message || "Registration successful",
        status: backendResponse.status,
        userID: data.userID || -1,
        data,
      };
    },
  }),

  logout: defineAction({
    accept: "form",
    handler: async (_, event) => {
      const url = `${serverAddress}/logout`;

      const backendResponse = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      const data = await backendResponse.json();
      if (!backendResponse.ok) {
        return {
          success: false,
          message: data || "Failed to logout",
          status: backendResponse.status,
          data,
        };
      }

      const setCookieHeader = backendResponse.headers.get("set-cookie");
      if (setCookieHeader) {
        const parsed = parseSetCookie(setCookieHeader);
        if (parsed) {
          event.cookies.set("token", "", {
            path: "/",
            httpOnly: true,
            // secure: parsed.secure,
            expires: parsed.expires,
          });
        }
      }

      return {
        success: true,
        message: data || "Logged out successfully",
        status: backendResponse.status,
        data,
      };
    },
  }),
};
