"use client";
import { useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type SignInFormProps = {
  initialEmail?: string;
  allowAnonymous?: boolean;
  onSuccess?: () => void | Promise<void>;
};

export function SignInForm({
  initialEmail = "",
  allowAnonymous = true,
  onSuccess,
}: SignInFormProps = {}) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [submitting, setSubmitting] = useState(false);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [sendingLink, setSendingLink] = useState(false);
  const isValidEmail = (s: string) => /[^\s@]+@[^\s@]+\.[^\s@]+/.test(s.trim());

  useEffect(() => {
    if (!initialEmail) return;
    setEmail(initialEmail);
  }, [initialEmail]);

  const handleSuccess = async () => {
    if (onSuccess) {
      await onSuccess();
      return;
    }
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <div className="w-full">
      <form
        className="flex flex-col gap-form-field"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitting(true);
          const formData = new FormData(e.target as HTMLFormElement);
          formData.set("flow", flow);
          void signIn("password", formData)
            .then(() => handleSuccess())
            .catch((error) => {
              let toastTitle = "";
              if (error.message.includes("Invalid password")) {
                toastTitle = "Invalid password. Please try again.";
              } else {
                toastTitle =
                  flow === "signIn"
                    ? "Could not sign in, did you mean to sign up?"
                    : "Could not sign up, did you mean to sign in?";
              }
              toast.error(toastTitle);
              setSubmitting(false);
            });
        }}
      >
        <input
          className="auth-input-field"
          type="email"
          name="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <p className="text-xs text-secondary mt-1">
          We'll email a secure sign-in link to the address you enter above.
        </p>
        <input
          className="auth-input-field"
          type="password"
          name="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button className="auth-button" type="submit" disabled={submitting}>
          {flow === "signIn" ? "Sign in" : "Sign up"}
        </button>
        <div className="text-center text-sm text-secondary">
          <span>
            {flow === "signIn"
              ? "Don't have an account? "
              : "Already have an account? "}
          </span>
          <button
            type="button"
            className="text-primary hover:text-primary-hover hover:underline font-medium cursor-pointer"
            onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
          >
            {flow === "signIn" ? "Sign up instead" : "Sign in instead"}
          </button>
        </div>
      </form>
      <div className="flex items-center justify-center my-3">
        <hr className="my-4 grow border-edge" />
        <span className="mx-4 text-secondary">or</span>
        <hr className="my-4 grow border-edge" />
      </div>
      <div className="flex flex-col gap-2">
        <button
          className="auth-button"
          onClick={() =>
            void signIn("google", {
              redirectTo:
                typeof window !== "undefined" ? window.location.href : "/",
            })
          }
        >
          Sign in with Google
        </button>
        <button
          type="button"
          className="auth-button disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={sendingLink || !isValidEmail(email)}
          onClick={() => {
            if (!isValidEmail(email)) {
              toast.error("Please enter a valid email address");
              return;
            }
            setSendingLink(true);
            const redirectTo =
              typeof window !== "undefined" ? window.location.origin : "/";
            signIn("email", { email, redirectTo })
              .then(() => {
                toast.success("Magic link sent! Check your email.");
              })
              .catch((error) => {
                console.error("Magic link: auth flow error");
                toast.error(
                  error instanceof Error
                    ? error.message
                    : "Failed to send magic link",
                );
              })
              .finally(() => {
                setSendingLink(false);
              });
          }}
        >
          {sendingLink ? "Sending..." : "Email me a sign-in link"}
        </button>
        {allowAnonymous ? (
          <button
            className="auth-button"
            onClick={() => void signIn("anonymous").then(() => handleSuccess())}
          >
            Sign in anonymously
          </button>
        ) : null}
      </div>
    </div>
  );
}
