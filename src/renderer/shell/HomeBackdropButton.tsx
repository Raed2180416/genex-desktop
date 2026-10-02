/**
 * Home's Background button, top right: the background's settings in a panel over home, so each
 * change is seen on home itself, undimmed, as it is made.
 */
import type { JSX } from "react";
import { BackdropControls, resetBackdrop } from "../home-backdrop/BackdropControls.tsx";
import { BackdropEffect } from "../home-backdrop/settings.ts";
import { useBackdrop } from "../home-backdrop/store.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/icons.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";

const MESSAGE = {
  button: "Background",
  heading: "Background",
  reset: "Reset",
} as const;

export function HomeBackdropButton(): JSX.Element {
  const settings = useBackdrop();
  return (
    <Popover>
      <PopoverTrigger
        render={<button type="button" />}
        aria-label={MESSAGE.button}
        data-home-backdrop-button
        className="home-backdrop-button"
      >
        <Icon name="image" size={16} />
      </PopoverTrigger>
      <PopoverContent align="end" className="backdrop-panel" data-home-backdrop-panel>
        <div className="backdrop-panel-heading">
          <h2>{MESSAGE.heading}</h2>
          {settings.effect !== BackdropEffect.Off && (
            <Button variant="ghost" onClick={resetBackdrop}>
              {MESSAGE.reset}
            </Button>
          )}
        </div>
        <BackdropControls settings={settings} />
      </PopoverContent>
    </Popover>
  );
}
