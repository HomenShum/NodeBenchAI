/**
 * FeedbackListener
 * A global component that listens for feedback events and triggers
 * audio/visual cues using the useFeedback hook.
 * Mount this at the app root level.
 */

import { useEffect } from "react";
import { useFeedback } from "./useFeedback";

export function FeedbackListener() {
    const { triggerSuccess, triggerError } = useFeedback();

    useEffect(() => {
        const handleSuccess = () => triggerSuccess();
        const handleError = () => triggerError();

        window.addEventListener("nodebench:feedback:success", handleSuccess);
        window.addEventListener("nodebench:feedback:error", handleError);

        return () => {
            window.removeEventListener("nodebench:feedback:success", handleSuccess);
            window.removeEventListener("nodebench:feedback:error", handleError);
        };
    }, [triggerSuccess, triggerError]);

    // This component renders nothing
    return null;
}

export default FeedbackListener;
